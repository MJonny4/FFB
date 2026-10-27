import { isIP } from "node:net";
import { RedisClient, type ServerWebSocket } from "bun";
import type { Config } from "@ffb/config";
import { clientMessage, serverMessage, z } from "@ffb/contracts";
import { database, DomainError, session } from "@ffb/database";
import { authenticate, readCookie, rateLimit, json, type Context } from "./http.ts";
import { authRoutes } from "./routes/auth.ts";
import { usersRoutes } from "./routes/users.ts";
import { footballRoutes } from "./routes/football.ts";
import { betsRoutes } from "./routes/bets.ts";
interface SocketData {
  token: string;
  userId: string;
  matchId: string | null;
  lastMessage: number;
  windowStart: number;
  messages: number;
  subscriptionEpoch: number;
}
const channel = "ffb:v1:changed";
export function startApi(config: Config, port = config.API_PORT) {
  const sql = database(config.DATABASE_URL),
    redis = new RedisClient(config.REDIS_URL),
    subscriber = new RedisClient(config.REDIS_URL);
  const sockets = new Set<ServerWebSocket<SocketData>>();
  let stopping = false;
  function send(ws: ServerWebSocket<SocketData>, value: z.infer<typeof serverMessage>) {
    const result = ws.send(JSON.stringify(serverMessage.parse(value)));
    if (result <= 0) ws.close(1013, "Reconnect and resynchronize");
  }
  function broadcast(change: z.infer<typeof serverMessage>) {
    if (change.type !== "changed") return;
    for (const ws of sockets)
      if (change.matchId === null || ws.data.matchId === change.matchId) send(ws, change);
  }
  void subscriber
    .subscribe(channel, (message) => {
      try {
        const parsed = serverMessage.safeParse(JSON.parse(message));
        if (parsed.success) broadcast(parsed.data);
      } catch {
        /* HTTP resynchronization repairs malformed or missed notifications. */
      }
    })
    .catch(() => console.warn("Live notifications unavailable; HTTP recovery remains active"));
  const server = Bun.serve<SocketData>({
    hostname: config.API_HOST,
    port,
    maxRequestBodySize: 2 * 1024 * 1024 + 65536,
    async fetch(request, server) {
      const url = new URL(request.url),
        path = url.pathname,
        origin = request.headers.get("origin");
      let response: Response;
      try {
        if (stopping) throw new DomainError(503, "Server stopping");
        if (path === "/health/live") return json({ status: "ok" });
        if (path === "/health/ready") {
          await sql`SELECT 1`;
          await redis.send("PING", []);
          return json({ status: "ready" });
        }
        if (origin && origin !== config.WEB_ORIGIN)
          throw new DomainError(403, "Origin is not allowed");
        if (request.method === "OPTIONS") {
          if (origin !== config.WEB_ORIGIN) throw new DomainError(403, "Origin is required");
          response = new Response(null, { status: 204 });
        } else {
          const unsafe = !["GET", "HEAD"].includes(request.method);
          if (
            unsafe &&
            (origin !== config.WEB_ORIGIN || request.headers.get("x-ffb-client") !== "web")
          )
            throw new DomainError(403, "Request origin and client header required");
          const ctx: Context = { sql, redis, config, request, userId: null, tokenHash: null };
          await authenticate(ctx);
          const proxyIp = request.headers.get("fly-client-ip");
          const ip =
            config.TRUST_FLY_PROXY === "true" && proxyIp && isIP(proxyIp)
              ? proxyIp
              : (server.requestIP(request)?.address ?? "unknown");
          if (path === "/api/ws") {
            if (origin !== config.WEB_ORIGIN)
              throw new DomainError(403, "WebSocket origin required");
            if (!ctx.userId) throw new DomainError(401, "Please sign in");
            await rateLimit(redis, `ws:${ctx.userId}`, 20, 60);
            if ([...sockets].filter((ws) => ws.data.userId === ctx.userId).length >= 5)
              throw new DomainError(429, "Too many open connections");
            if (
              server.upgrade(request, {
                data: {
                  token: readCookie(request, config.NODE_ENV === "production")!,
                  userId: ctx.userId,
                  matchId: null,
                  lastMessage: Date.now(),
                  windowStart: Date.now(),
                  messages: 0,
                  subscriptionEpoch: 0,
                },
              })
            )
              return;
            throw new DomainError(400, "WebSocket upgrade required");
          }
          if (unsafe) {
            const sensitive =
              path.startsWith("/api/auth/") ||
              path.includes("/password") ||
              path.includes("/deactivate");
            await rateLimit(
              redis,
              `${sensitive ? "auth" : "write"}:${ip}`,
              sensitive ? 12 : 120,
              60,
            );
            if (ctx.userId) await rateLimit(redis, `user:${ctx.userId}`, 120, 60);
          }
          response =
            (await authRoutes(ctx, path)) ??
            (await usersRoutes(ctx, path)) ??
            (await footballRoutes(ctx, path)) ??
            (await betsRoutes(ctx, path)) ??
            json({ error: "Route not found" }, 404);
          if (unsafe && response.ok) {
            const change = { v: 1 as const, type: "changed" as const, matchId: null, revision: 0 };
            broadcast(change);
            void redis.publish(channel, JSON.stringify(change)).catch(() => undefined);
          }
        }
      } catch (error) {
        if (error instanceof DomainError) response = json({ error: error.message }, error.status);
        else if (error instanceof z.ZodError)
          response = json({ error: "Invalid request data" }, 400);
        else if (error && typeof error === "object" && "errno" in error && error.errno === "23505")
          response = json({ error: "That value is unavailable" }, 409);
        else {
          console.error("API request failed", { path });
          response = json({ error: "Service temporarily unavailable" }, 503);
        }
      }
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("X-Content-Type-Options", "nosniff");
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("Vary", "Origin");
      if (origin === config.WEB_ORIGIN) {
        response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set("Access-Control-Allow-Credentials", "true");
        response.headers.set("Access-Control-Allow-Headers", "Content-Type,X-FFB-Client");
        response.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      }
      if (response.status === 429) response.headers.set("Retry-After", "60");
      return response;
    },
    websocket: {
      maxPayloadLength: 4096,
      idleTimeout: 60,
      sendPings: true,
      backpressureLimit: 128 * 1024,
      closeOnBackpressureLimit: true,
      open(ws) {
        sockets.add(ws);
        send(ws, { v: 1, type: "ready" });
      },
      async message(ws, message) {
        try {
          const now = Date.now();
          if (now - ws.data.windowStart >= 10000) {
            ws.data.messages = 0;
            ws.data.windowStart = now;
          }
          if (++ws.data.messages > 30) {
            ws.close(1008, "Too many messages");
            return;
          }
          if (typeof message !== "string") {
            ws.close(1003, "JSON text required");
            return;
          }
          const parsed = clientMessage.safeParse(JSON.parse(message));
          if (!parsed.success) {
            ws.close(1008, "Invalid protocol message");
            return;
          }
          const value = parsed.data;
          const epoch = value.type === "ping" ? null : ++ws.data.subscriptionEpoch;
          if (!(await session(sql, ws.data.token))) {
            ws.close(1008, "Session expired");
            return;
          }
          ws.data.lastMessage = now;
          if (epoch !== null && epoch !== ws.data.subscriptionEpoch) return;
          if (value.type === "ping") send(ws, { v: 1, type: "pong" });
          if (value.type === "unsubscribe") ws.data.matchId = null;
          if (value.type === "subscribe") {
            const [m] = await sql`SELECT revision FROM matches WHERE id=${value.matchId}`;
            if (epoch !== ws.data.subscriptionEpoch) return;
            if (!m) {
              send(ws, { v: 1, type: "error", message: "Match not found" });
              return;
            }
            // Set before snapshot invalidation; clients fetch HTTP and ignore stale revisions.
            ws.data.matchId = value.matchId;
            send(ws, { v: 1, type: "changed", matchId: value.matchId, revision: m.revision });
          }
        } catch {
          ws.close(1008, "Invalid message");
        }
      },
      close(ws) {
        sockets.delete(ws);
      },
    },
  });
  const heartbeat = setInterval(() => {
    for (const ws of sockets) {
      if (Date.now() - ws.data.lastMessage > 60000) ws.close(1001, "Heartbeat expired");
      else
        void session(sql, ws.data.token)
          .then((s) => {
            if (!s) ws.close(1008, "Session expired");
          })
          .catch(() => ws.close(1013, "Reconnect"));
    }
  }, 15000);
  return {
    server,
    sql,
    redis,
    async close() {
      stopping = true;
      clearInterval(heartbeat);
      for (const ws of sockets) ws.close(1001, "Server stopping");
      const force = setTimeout(() => void server.stop(true), 10000);
      force.unref();
      try {
        await server.stop(false);
      } finally {
        clearTimeout(force);
      }
      subscriber.close();
      redis.close();
      await sql.close();
    },
  };
}
