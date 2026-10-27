import { signupInput, loginInput, forgotInput, resetInput, tokenInput } from "@ffb/contracts";
import { signup, login, user, requestToken, consumeToken } from "@ffb/database";
import { input, json, requireUser, cookie, type Context } from "../http.ts";
export async function authRoutes(ctx: Context, path: string) {
  const { request, sql, config } = ctx;
  if (path === "/api/auth/session" && request.method === "GET")
    return json(ctx.userId ? await user(sql, ctx.userId) : null);
  if (request.method !== "POST" || !path.startsWith("/api/auth/")) return null;
  const production = config.NODE_ENV === "production";
  if (path === "/api/auth/signup" || path === "/api/auth/login") {
    const result = path.endsWith("/signup")
      ? await signup(sql, await input(request, signupInput), config.WEB_ORIGIN)
      : await (async () => {
          const v = await input(request, loginInput);
          return login(sql, v.email, v.password);
        })();
    const response = json(
      { user: await user(sql, result.userId) },
      path.endsWith("/signup") ? 201 : 200,
    );
    response.headers.set("Set-Cookie", cookie(result.token, production));
    return response;
  }
  if (path === "/api/auth/logout") {
    requireUser(ctx);
    await sql`DELETE FROM sessions WHERE token_hash=${ctx.tokenHash}`;
    return new Response(null, {
      status: 204,
      headers: { "Set-Cookie": cookie("", production, 0) },
    });
  }
  if (path === "/api/auth/forgot-password") {
    const v = await input(request, forgotInput);
    return json(await requestToken(sql, "reset", config.WEB_ORIGIN, { email: v.email }), 202);
  }
  if (path === "/api/auth/resend-verification")
    return json(
      await requestToken(sql, "verify", config.WEB_ORIGIN, { userId: requireUser(ctx) }),
      202,
    );
  if (path === "/api/auth/verify-email") {
    const v = await input(request, tokenInput);
    await consumeToken(sql, v.token, "verify");
    return json({ verified: true });
  }
  if (path === "/api/auth/reset-password") {
    const v = await input(request, resetInput),
      result = await consumeToken(sql, v.token, "reset", v.password);
    const response = json({ user: await user(sql, result.userId) });
    response.headers.set("Set-Cookie", cookie(result.token!, production));
    return response;
  }
  return null;
}
