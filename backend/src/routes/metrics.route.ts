import { Router } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { browserSecurity } from "../middleware/browser-security.middleware.js";
import { getOwnedProject } from "../services/project.service.js";
import { AppError } from "../utils/app-error.js";

const filters = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
type Row = {
  count: number;
  errors: number;
  averageLatency: number | null;
  bucket?: Date;
  route?: string;
  method?: string;
};
const totals = Prisma.sql`COUNT(*)::int AS count, COUNT(*) FILTER (WHERE "statusCode" >= 500)::int AS errors, AVG("responseTime") AS "averageLatency"`;
export function createMetricsRoutes(db: PrismaClient, origin: string) {
  const routes = Router();
  routes.use(browserSecurity(origin), requireAuth(db));
  routes.get("/:projectId/metrics/:kind", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const project = await getOwnedProject(
      db,
      req.auth!.user.id,
      req.params.projectId,
    );
    const parsed = filters.safeParse(req.query);
    if (!parsed.success)
      throw new AppError("Invalid metrics filters.", 400, "VALIDATION_ERROR");
    const { page, pageSize } = parsed.data;
    const from = new Date(parsed.data.from),
      to = new Date(parsed.data.to);
    const seconds = (to.getTime() - from.getTime()) / 1000;
    if (seconds <= 0 || seconds > 86400)
      throw new AppError(
        "Choose a range between 1 ms and 24 hours.",
        400,
        "VALIDATION_ERROR",
      );
    const where = Prisma.sql`FROM "TelemetryEvent" WHERE "projectId" = ${project.id} AND timestamp >= ${from} AND timestamp < ${to}`;
    const enrich = (row: Row, duration = seconds) => ({
      ...row,
      requestsPerSecond: row.count / duration,
      errorRate: row.count ? (row.errors / row.count) * 100 : 0,
    });
    if (req.params.kind === "overview") {
      const rows = await db.$queryRaw<Row[]>(
        Prisma.sql`SELECT ${totals} ${where}`,
      );
      res.json(enrich(rows[0]!));
    } else if (req.params.kind === "series") {
      const rows = await db.$queryRaw<Row[]>(
        Prisma.sql`SELECT date_trunc('minute', timestamp) AS bucket, ${totals} ${where} GROUP BY bucket ORDER BY bucket`,
      );
      const byTime = new Map(rows.map((row) => [row.bucket!.getTime(), row]));
      const points = [];
      for (
        let time = Math.floor(from.getTime() / 60000) * 60000;
        time < to.getTime();
        time += 60000
      ) {
        const duration =
          (Math.min(time + 60000, to.getTime()) -
            Math.max(time, from.getTime())) /
          1000;
        points.push(
          enrich(
            byTime.get(time) ?? {
              bucket: new Date(time),
              count: 0,
              errors: 0,
              averageLatency: null,
            },
            duration,
          ),
        );
      }
      res.json({ points });
    } else if (req.params.kind === "endpoints") {
      const rows = await db.$queryRaw<Row[]>(
        Prisma.sql`SELECT route, method, ${totals} ${where} GROUP BY route, method ORDER BY count DESC, route, method LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`,
      );
      res.json({
        endpoints: rows.slice(0, pageSize).map((row) => enrich(row)),
        page,
        pageSize,
        hasMore: rows.length > pageSize,
      });
    } else throw new AppError("Metric not found.", 404, "NOT_FOUND");
  });
  return routes;
}
