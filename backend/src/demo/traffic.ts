import { setTimeout as sleep } from 'node:timers/promises';

export async function runTraffic(baseUrl: string, count = 30) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Traffic is restricted to the local demo API');
  }
  if (!Number.isInteger(count) || count < 1 || count > 300) throw new Error('DEMO_REQUESTS must be 1-300');
  const counts = { normal: 0, slow: 0, failing: 0 };
  for (let index = 0; index < count; index++) {
    const kind = index % 3;
    const path = kind === 0 ? `/items/${index}` : kind === 1 ? '/slow' : '/fail';
    const response = await fetch(new URL(path, url), { signal: AbortSignal.timeout(10000), redirect: 'error' });
    await response.body?.cancel();
    if (response.status !== (kind === 2 ? 500 : 200)) throw new Error('Unexpected demo response');
    counts[kind === 0 ? 'normal' : kind === 1 ? 'slow' : 'failing']++;
    await sleep(20);
  }
  return counts;
}
