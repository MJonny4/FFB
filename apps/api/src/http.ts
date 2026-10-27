import type { SQL, RedisClient } from "bun";
import type { Config } from "@ffb/config";
import { z } from "@ffb/contracts";
import { DomainError, session } from "@ffb/database";
export interface Context {
  sql: SQL;
  redis: RedisClient;
  config: Config;
  request: Request;
  userId: string | null;
  tokenHash: string | null;
}
export function json(value: unknown, status = 200) {
  return Response.json(value, { status });
}
export async function input<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new DomainError(415, "JSON body required");
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new DomainError(400, "Invalid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) throw new DomainError(400, "Invalid request data");
  return result.data;
}
export function requireUser(ctx: Context) {
  if (!ctx.userId) throw new DomainError(401, "Please sign in");
  return ctx.userId;
}
export function cookie(token: string, production: boolean, maxAge = 30 * 86400) {
  return `${production ? "__Host-ffb_session" : "ffb_session"}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${production ? "; Secure" : ""}`;
}
export function readCookie(request: Request, production: boolean) {
  const key = production ? "__Host-ffb_session" : "ffb_session";
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}
export async function authenticate(ctx: Context) {
  const current = await session(
    ctx.sql,
    readCookie(ctx.request, ctx.config.NODE_ENV === "production"),
  );
  ctx.userId = current?.userId ?? null;
  ctx.tokenHash = current?.tokenHash ?? null;
}
export async function rateLimit(redis: RedisClient, key: string, limit: number, seconds: number) {
  const script =
    "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n";
  let count: number;
  try {
    count = Number(await redis.send("EVAL", [script, "1", `ffb:limit:${key}`, String(seconds)]));
  } catch {
    throw new DomainError(503, "Please retry shortly");
  }
  if (count > limit) throw new DomainError(429, "Too many requests; please retry later");
}
