import { z } from 'zod';

export const eventSchema = z.object({
  eventId: z.string().uuid(),
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  service: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  environment: z.enum(['development', 'test', 'staging', 'production']),
  route: z.string().max(160).regex(/^\/[a-zA-Z0-9_/:.*-]*$/),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']),
  statusCode: z.number().int().min(100).max(599),
  responseTime: z.number().finite().min(0).max(60000),
  timestamp: z.string().datetime({ offset: true }),
}).strict();
export const batchSchema = z.object({ events: z.array(eventSchema).min(1).max(50) }).strict();
export const jobSchema = batchSchema.extend({
  projectId: z.string().uuid(), requestId: z.string().max(80),
}).strict();
export type TelemetryEvent = z.infer<typeof eventSchema>;
export type TelemetryJob = z.infer<typeof jobSchema>;

export const ingestionSchema = batchSchema.refine(({ events }) => {
  const now = Date.now();
  return events.every(event => {
    const time = Date.parse(event.timestamp);
    return time >= now - 24 * 60 * 60 * 1000 && time <= now + 5 * 60 * 1000;
  });
});
