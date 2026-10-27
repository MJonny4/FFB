import { z } from "zod";
const url = z.url();
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRUST_FLY_PROXY: z.enum(["true", "false"]).default("false"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: url.refine((s) => /^postgres(ql)?:/.test(s)),
  DIRECT_DATABASE_URL: url.optional(),
  REDIS_URL: url.refine((s) => /^rediss?:/.test(s)),
  WEB_ORIGIN: url.default("http://localhost:5173"),
  MAIL_MODE: z.enum(["capture", "resend"]).default("capture"),
  MAIL_FROM: z.string().default("FFB <noreply@localhost>"),
  RESEND_API_KEY: z.string().optional(),
});
export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const config = schema.parse({ ...env, API_PORT: env.API_PORT ?? env.PORT });
  if (new URL(config.WEB_ORIGIN).origin !== config.WEB_ORIGIN)
    throw new Error("WEB_ORIGIN must be an origin without a path");
  if (
    config.NODE_ENV === "production" &&
    (!config.WEB_ORIGIN.startsWith("https://") ||
      config.MAIL_MODE !== "resend" ||
      !config.RESEND_API_KEY ||
      !config.REDIS_URL.startsWith("rediss://"))
  )
    throw new Error("Production requires HTTPS, TLS Redis and an email provider");
  return config;
}
export type Config = ReturnType<typeof loadConfig>;
