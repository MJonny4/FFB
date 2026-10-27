import { betInput, id } from "@ffb/contracts";
import { bets, placeBet, cancelBet } from "@ffb/database";
import { input, json, requireUser, type Context } from "../http.ts";
export async function betsRoutes(ctx: Context, path: string) {
  if (path === "/api/bets") {
    const userId = requireUser(ctx);
    if (ctx.request.method === "GET") return json(await bets(ctx.sql, userId));
    if (ctx.request.method === "POST")
      return json(await placeBet(ctx.sql, userId, await input(ctx.request, betInput)), 201);
  }
  const match = /^\/api\/bets\/([^/]+)$/.exec(path);
  if (match && ctx.request.method === "DELETE")
    return json(await cancelBet(ctx.sql, requireUser(ctx), id.parse(match[1])));
  return null;
}
