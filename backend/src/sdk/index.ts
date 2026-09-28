import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { RequestHandler } from 'express';
import type { TelemetryEvent } from '../telemetry/schema.js';

export interface TelemetryOptions {
  endpoint: string;
  apiKey: string;
  service: string;
  environment?: TelemetryEvent['environment'];
  routePrefix?: string;
  bufferLimit?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffMs?: number;
  maxRetryDelayMs?: number;
}

function bounded(value: number | undefined, fallback: number, max: number, name: string) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < 1 || result > max) throw new Error(`Invalid SDK option: ${name}`);
  return result;
}

export function createTelemetrySDK(options: TelemetryOptions) {
  let endpoint: URL;
  try { endpoint = new URL(options.endpoint); } catch { throw new Error('Invalid SDK endpoint'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Invalid SDK endpoint');
  }
  if (!/^[a-zA-Z0-9_-]{24,128}$/.test(options.apiKey)) throw new Error('Invalid SDK API key');
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(options.service)) throw new Error('Invalid SDK service');
  const environment = options.environment ?? 'development';
  if (!['development', 'test', 'staging', 'production'].includes(environment)) throw new Error('Invalid SDK environment');
  const prefix = options.routePrefix ?? '';
  if (prefix && (!/^\/[a-zA-Z0-9_/-]*$/.test(prefix) || prefix.length > 80)) throw new Error('Invalid SDK route prefix');
  const bufferLimit = bounded(options.bufferLimit, 500, 5000, 'bufferLimit');
  const batchSize = bounded(options.batchSize, 20, 50, 'batchSize');
  const intervalMs = bounded(options.flushIntervalMs, 1000, 10000, 'flushIntervalMs');
  const timeoutMs = bounded(options.timeoutMs, 1000, 5000, 'timeoutMs');
  const maxAttempts = bounded(options.maxAttempts, 3, 5, 'maxAttempts');
  const backoffMs = bounded(options.backoffMs, 250, 5000, 'backoffMs');
  const maxRetryDelay = bounded(options.maxRetryDelayMs, 5000, 10000, 'maxRetryDelayMs');
  const buffer: TelemetryEvent[] = [];
  let inFlight: TelemetryEvent[] = [];
  let running: Promise<void> | undefined;
  let accepting = true;
  let shutdownPromise: Promise<void> | undefined;
  const lifecycle = new AbortController();
  const counters = { captured: 0, queued: 0, dropped: 0, retryAttempts: 0 };

  async function sendBatch(batch: TelemetryEvent[]) {
    for (let attempt = 0; attempt < maxAttempts && !lifecycle.signal.aborted; attempt++) {
      if (attempt > 0) counters.retryAttempts++;
      let retryDelay = Math.min(backoffMs * 2 ** attempt, maxRetryDelay);
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), timeoutMs);
      timer.unref();
      try {
        const response = await fetch(endpoint, {
          method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': options.apiKey },
          body: JSON.stringify({ events: batch }), signal: AbortSignal.any([timeout.signal, lifecycle.signal]),
        });
        await response.body?.cancel();
        if (response.status === 202) { counters.queued += batch.length; return; }
        if (response.status !== 408 && response.status !== 429 && response.status < 500) break;
        const hint = response.headers.get('Retry-After');
        if (hint) {
          const milliseconds = /^\d+$/.test(hint) ? Number(hint) * 1000 : Date.parse(hint) - Date.now();
          if (Number.isFinite(milliseconds)) retryDelay = Math.min(maxRetryDelay, Math.max(retryDelay, milliseconds));
        }
      } catch { /* Transport errors/timeouts are bounded retries, never application errors. */ }
      finally { clearTimeout(timer); }
      if (attempt + 1 < maxAttempts && !lifecycle.signal.aborted) {
        await sleep(retryDelay, undefined, { signal: lifecycle.signal }).catch(() => {});
      }
    }
    counters.dropped += batch.length;
  }

  async function pump() {
    while (buffer.length && !lifecycle.signal.aborted) {
      inFlight = buffer.splice(0, batchSize);
      try { await sendBatch(inFlight); }
      catch { counters.dropped += inFlight.length; }
      finally { inFlight = []; }
    }
    if (lifecycle.signal.aborted) { counters.dropped += buffer.length; buffer.length = 0; }
  }
  function flush(): Promise<void> {
    return running ??= pump().finally(() => { running = undefined; });
  }
  const interval = setInterval(() => { void flush(); }, intervalMs);
  interval.unref();

  const middleware: RequestHandler = (req, res, next) => {
    const start = performance.now();
    res.once('finish', () => {
      if (!accepting) return;
      try {
        const duration = Math.round((performance.now() - start) * 100) / 100;
        if (duration > 60000 || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method)) {
          counters.dropped++; return;
        }
        // Never use originalUrl, path, query, baseUrl, headers or body as telemetry labels.
        // Mounted routers may supply a static routePrefix in configuration.
        const template = typeof req.route?.path === 'string' ? prefix + req.route.path : '/unmatched';
        const route = /^\/[a-zA-Z0-9_/:.*-]*$/.test(template) && template.length <= 160 ? template : '/unmatched';
        if (buffer.length + inFlight.length >= bufferLimit) { counters.dropped++; return; }
        buffer.push({ eventId: randomUUID(), requestId: randomUUID(), service: options.service, environment,
          route, method: req.method as TelemetryEvent['method'], statusCode: res.statusCode,
          responseTime: duration, timestamp: new Date().toISOString() });
        counters.captured++;
        if (buffer.length >= batchSize) void flush();
      } catch { counters.dropped++; }
    });
    next();
  };

  function shutdown(deadlineMs = 3000): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    if (!Number.isInteger(deadlineMs) || deadlineMs < 0 || deadlineMs > 10000) throw new Error('Invalid SDK shutdown deadline');
    accepting = false; clearInterval(interval);
    shutdownPromise = (async () => {
      const deadline = setTimeout(() => lifecycle.abort(), deadlineMs);
      try { await flush(); }
      finally { clearTimeout(deadline); lifecycle.abort(); }
    })();
    return shutdownPromise;
  }
  return { middleware, flush, shutdown,
    stats: () => ({ ...counters, pending: buffer.length + inFlight.length }) };
}
