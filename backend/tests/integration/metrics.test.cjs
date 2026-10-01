const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { PrismaClient } = require("@prisma/client");
const { Router } = require("express");
const { createApp } = require("../../dist/app.js");
const { createMetricsRoutes } = require("../../dist/routes/metrics.route.js");
const { hashSessionToken } = require("../../dist/services/auth.service.js");
test("authorized SQL analytics: weighted means, boundaries, zeros, paging and isolation", async () => {
  const db = new PrismaClient();
  const id = randomUUID(),
    foreign = randomUUID(),
    token = "a".repeat(64);
  let server;
  try {
    await db.user.create({
      data: {
        id,
        name: "Metrics test",
        email: id + "@test.local",
        passwordHash: "unused",
      },
    });
    await db.session.create({
      data: {
        userId: id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const p = await db.project.create({
      data: { userId: id, name: "Metrics test", environment: "test" },
    });
    await db.user.create({
      data: {
        id: foreign,
        name: "Other",
        email: foreign + "@test.local",
        passwordHash: "unused",
      },
    });
    const other = await db.project.create({
      data: { userId: foreign, name: "Private", environment: "test" },
    });
    const events = [0, 1, 2, 3].map((n) => ({
      projectId: p.id,
      eventId: randomUUID(),
      service: "test",
      route: n === 2 ? "/b" : "/a",
      method: "GET",
      statusCode: n === 2 ? 500 : 200,
      responseTime: [10, 20, 90, 900][n],
      environment: "test",
      requestId: randomUUID(),
      timestamp: new Date("2026-01-01T00:0" + [0, 0, 1, 3][n] + ":00Z"),
    }));
    await db.telemetryEvent.createMany({ data: events });
    await db.telemetryEvent.createMany({ data: events, skipDuplicates: true });
    const routes = Router();
    routes.use("/projects", createMetricsRoutes(db, "http://localhost:5173"));
    server = createApp(routes).listen(0, "127.0.0.1");
    await once(server, "listening");
    const query = "?from=2026-01-01T00:00:00Z&to=2026-01-01T00:03:00Z";
    const get = (kind, qs = query, project = p.id, cookie = true) =>
      fetch(
        `http://127.0.0.1:${server.address().port}/projects/${project}/metrics/${kind}${qs}`,
        { headers: cookie ? { Cookie: "pm_session=" + token } : {} },
      );
    const overview = await (await get("overview")).json();
    assert.equal(overview.count, 3);
    assert.equal(overview.errors, 1);
    assert.equal(overview.averageLatency, 40);
    assert.equal(overview.requestsPerSecond, 3 / 180);
    assert.ok(Math.abs(overview.errorRate - 100 / 3) < 1e-10);
    const series = await (await get("series")).json();
    assert.equal(series.points.length, 3);
    assert.equal(series.points[0].count, 2);
    assert.equal(series.points[2].averageLatency, null);
    const partial = await (
      await get("series", "?from=2026-01-01T00:00:30Z&to=2026-01-01T00:01:30Z")
    ).json();
    assert.equal(partial.points[1].requestsPerSecond, 1 / 30);
    const endpoints = await (
      await get("endpoints", query + "&pageSize=1")
    ).json();
    assert.equal(endpoints.endpoints.length, 1);
    assert.equal(endpoints.hasMore, true);
    assert.equal(endpoints.endpoints[0].averageLatency, 15);
    const empty = await (
      await get(
        "overview",
        "?from=2025-01-01T00:00:00Z&to=2025-01-01T00:01:00Z",
      )
    ).json();
    assert.equal(empty.count, 0);
    assert.equal(empty.averageLatency, null);
    assert.equal((await get("overview", query, other.id)).status, 404);
    assert.equal((await get("overview", query, p.id, false)).status, 401);
    for (const qs of [
      "?from=bad&to=bad",
      query + "&pageSize=51",
      query + "&extra=1",
      "?from=2026-01-01T00:00:00Z&to=2026-01-03T00:00:00Z",
      "?from=2026-01-01T00:00:00Z&to=2026-01-01T00:00:00Z",
    ])
      assert.equal((await get("overview", qs)).status, 400);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.telemetryEvent.deleteMany({ where: { project: { userId: id } } });
    await db.project.deleteMany({ where: { userId: { in: [id, foreign] } } });
    await db.user.deleteMany({ where: { id: { in: [id, foreign] } } });
    await db.$disconnect();
  }
});
