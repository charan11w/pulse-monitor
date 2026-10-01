import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { Redis, type RedisOptions } from "ioredis";
import type { PrismaClient } from "@prisma/client";
import { hashSessionToken } from "./services/auth.service.js";
import { getOwnedProject } from "./services/project.service.js";

export const METRICS_CHANNEL = "pulsemonitor:metrics";
export function attachLive(
  server: HttpServer,
  db: PrismaClient,
  origin: string,
  options: RedisOptions,
) {
  const io = new Server(server, {
    cors: { origin, credentials: true },
    maxHttpBufferSize: 4096,
    allowRequest: (req, done) => done(null, req.headers.origin === origin),
  });
  const subscriber = new Redis({ ...options, maxRetriesPerRequest: 0 });
  subscriber.on("error", () => {});
  async function identity(cookie = "") {
    const tokens = cookie
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith("pm_session="));
    const token = tokens.length === 1 ? tokens[0]!.slice(11) : "";
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("UNAUTHENTICATED");
    const session = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    if (!session || session.expiresAt.getTime() <= Date.now())
      throw new Error("UNAUTHENTICATED");
    return session;
  }
  io.use(async (socket, next) => {
    try {
      await identity(socket.handshake.headers.cookie);
      next();
    } catch {
      next(new Error("UNAUTHENTICATED"));
    }
  });
  io.on("connection", (socket) => {
    let joining = false;
    socket.on("subscribe", async (projectId: unknown, reply: unknown) => {
      if (typeof reply !== "function" || joining) return;
      joining = true;
      try {
        // Leave before validating: a failed switch never retains a previous private room.
        for (const room of socket.rooms)
          if (room !== socket.id) await socket.leave(room);
        const session = await identity(socket.handshake.headers.cookie);
        const project = await getOwnedProject(db, session.userId, projectId);
        if (socket.connected) {
          await socket.join(project.id);
          reply({ ok: true });
        }
      } catch {
        reply({ ok: false });
      } finally {
        joining = false;
      }
    });
  });
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      await Promise.all(
        [...io.sockets.sockets.values()].map(async (socket) => {
          try {
            await identity(socket.handshake.headers.cookie);
          } catch {
            socket.disconnect(true);
          }
        }),
      );
    } finally {
      checking = false;
    }
  }, 1000);
  timer.unref();
  // Coalesce Redis messages per project before authorization and delivery.
  const pending = new Set<string>();
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  subscriber.on("message", (_channel, projectId) => {
    if (!/^[0-9a-f-]{36}$/.test(projectId) || pending.size >= 1000) return;
    pending.add(projectId);
    if (scheduled) return;
    scheduled = setTimeout(() => {
      scheduled = undefined;
      const projects = [...pending];
      pending.clear();
      void Promise.all(
        projects.flatMap((id) =>
          [...(io.sockets.adapter.rooms.get(id) ?? [])].map(
            async (socketId) => {
              const socket = io.sockets.sockets.get(socketId);
              if (!socket) return;
              try {
                const session = await identity(socket.handshake.headers.cookie);
                await getOwnedProject(db, session.userId, id);
                if (socket.rooms.has(id))
                  socket.emit("metrics:changed", { projectId: id });
              } catch {
                socket.disconnect(true);
              }
            },
          ),
        ),
      );
    }, 250);
  });
  void subscriber.subscribe(METRICS_CHANNEL).catch(() => {});
  return {
    io,
    async close() {
      clearInterval(timer);
      if (scheduled) clearTimeout(scheduled);
      subscriber.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
