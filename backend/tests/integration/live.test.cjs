const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { PrismaClient } = require("@prisma/client");
const { Redis } = require("ioredis");
const { io } = require("socket.io-client");
const { attachLive, METRICS_CHANNEL } = require("../../dist/live.js");
const { localRedisOptions } = require("../../dist/telemetry/queue.js");
const { hashSessionToken } = require("../../dist/services/auth.service.js");
const { createProcessor } = require("../../dist/telemetry/processor.js");
test(
  "post-commit invalidation, private subscriptions, switching, reconnect and revoked/expired sessions",
  { timeout: 30000 },
  async () => {
    const db = new PrismaClient(),
      id = randomUUID(),
      otherId = randomUUID(),
      token = randomBytes(32).toString("hex");
    const server = createServer();
    const origin = "http://localhost:5173";
    let live, client;
    const publisher = new Redis(localRedisOptions());
    publisher.on("error", () => {});
    const clients = [];
    const connect = (cookie = "pm_session=" + token, customOrigin = origin) => {
      const c = io("http://127.0.0.1:" + server.address().port, {
        transports: ["websocket"],
        extraHeaders: { Origin: customOrigin, Cookie: cookie },
        reconnection: false,
        timeout: 3000,
      });
      clients.push(c);
      return c;
    };
    try {
      for (const userId of [id, otherId])
        await db.user.create({
          data: {
            id: userId,
            name: "Socket test",
            email: userId + "@test.local",
            passwordHash: "unused",
          },
        });
      const p = await db.project.create({
          data: { userId: id, name: "Live", environment: "test" },
        }),
        second = await db.project.create({
          data: { userId: id, name: "Second", environment: "test" },
        }),
        foreign = await db.project.create({
          data: { userId: otherId, name: "Private", environment: "test" },
        });
      await db.session.create({
        data: {
          userId: id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      live = attachLive(server, db, origin, localRedisOptions());
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      await once(connect(""), "connect_error");
      await once(
        connect("pm_session=" + token, "http://evil.test"),
        "connect_error",
      );
      client = connect();
      await once(client, "connect");
      const subscribe = (project) =>
        client.timeout(3000).emitWithAck("subscribe", project);
      assert.equal((await subscribe(foreign.id)).ok, false);
      assert.equal((await subscribe(p.id)).ok, true);
      const event = {
        eventId: randomUUID(),
        requestId: randomUUID(),
        route: "/live",
        service: "test",
        environment: "test",
        method: "GET",
        statusCode: 200,
        responseTime: 10,
        timestamp: new Date().toISOString(),
      };
      const processor = createProcessor(db, async (projectId) => {
        assert.equal(
          await db.telemetryEvent.count({
            where: { projectId, eventId: event.eventId },
          }),
          1,
        );
        await publisher.publish(METRICS_CHANNEL, projectId);
      });
      const notification = once(client, "metrics:changed");
      await processor({
        data: { projectId: p.id, requestId: randomUUID(), events: [event] },
      });
      assert.equal((await notification)[0].projectId, p.id);
      // Publishing failure does not undo a committed write or fail processing.
      const result = await createProcessor(db, async () => {
        throw new Error("offline");
      })({
        data: { projectId: p.id, requestId: randomUUID(), events: [event] },
      });
      assert.equal(result.inserted, 0);
      assert.equal((await subscribe(second.id)).ok, true);
      let changes = 0;
      client.on("metrics:changed", () => changes++);
      await publisher.publish(METRICS_CHANNEL, p.id);
      await delay(500);
      assert.equal(changes, 0);
      // Send one burst, rather than twenty network round trips that can legitimately
      // span several coalescing windows on a slow laptop.
      await publisher.pipeline(Array.from({ length: 20 }, () => ['publish', METRICS_CHANNEL, second.id])).exec();
      await delay(700);
      assert.equal(changes, 1);
      client.disconnect();
      await publisher.publish(METRICS_CHANNEL, p.id);
      client.connect();
      await once(client, "connect");
      assert.equal((await subscribe(p.id)).ok, true);
      const disconnected = once(client, "disconnect");
      await db.session.delete({ where: { userId: id } });
      await publisher.publish(METRICS_CHANNEL, p.id);
      await disconnected;
      await db.session.create({
        data: {
          userId: id,
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + 2000),
        },
      });
      const expiring = connect();
      await once(expiring, "connect");
      await once(expiring, "disconnect");
    } finally {
      clients.forEach((c) => c.disconnect());
      if (live) await live.close();
      publisher.disconnect();
      await db.telemetryEvent.deleteMany({
        where: { project: { userId: id } },
      });
      await db.project.deleteMany({ where: { userId: { in: [id, otherId] } } });
      await db.user.deleteMany({ where: { id: { in: [id, otherId] } } });
      await db.$disconnect();
    }
  },
);
