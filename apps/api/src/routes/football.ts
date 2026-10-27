import { lineupInput, id as idSchema, eventSchema, z } from "@ffb/contracts";
import {
  teams,
  teamDetail,
  currentRound,
  matches,
  matchCenter,
  standings,
  leaderboard,
  claimTeam,
  saveDraft,
  publishDraft,
  DomainError,
} from "@ffb/database";
import { input, json, requireUser, type Context } from "../http.ts";
export async function footballRoutes(ctx: Context, path: string) {
  const { sql, request } = ctx,
    method = request.method,
    url = new URL(request.url);
  if (method === "GET") {
    if (path === "/api/teams") return json(await teams(sql));
    if (path === "/api/rounds/current") return json(await currentRound(sql));
    if (path === "/api/standings") return json(await standings(sql));
    if (path === "/api/leaderboard") return json(await leaderboard(sql));
    if (path === "/api/teams/me") {
      const all = await sql`SELECT id FROM teams WHERE manager_id=${requireUser(ctx)}`;
      return json(all[0] ? await teamDetail(sql, all[0].id, ctx.userId!) : null);
    }
  }
  if (path === "/api/teams/me/draft" && method === "PUT")
    return json(await saveDraft(sql, requireUser(ctx), await input(request, lineupInput)));
  if (path === "/api/teams/me/publish" && method === "POST")
    return json(await publishDraft(sql, requireUser(ctx)));
  if (path === "/api/teams/me/lineup" && method === "PUT") {
    const userId = requireUser(ctx);
    await saveDraft(sql, userId, await input(request, lineupInput));
    return json(await publishDraft(sql, userId));
  }
  const team = /^\/api\/teams\/([^/]+)(\/(history|claim))?$/.exec(path);
  if (team) {
    const id = idSchema.parse(team[1]);
    if (team[3] === "claim" && method === "POST")
      return json(await claimTeam(sql, requireUser(ctx), id));
    if (team[3] === "history" && method === "GET") {
      const cursor = url.searchParams.get("cursor");
      if (cursor && !z.iso.datetime().safeParse(cursor).success)
        throw new DomainError(400, "Invalid cursor");
      return json(
        await matches(sql, { teamId: id, ...(cursor ? { before: cursor } : {}), limit: 20 }),
      );
    }
    if (!team[3] && method === "GET")
      return json(await teamDetail(sql, id, ctx.userId ?? undefined));
  }
  const match = /^\/api\/matches\/([^/]+)\/(live|events)$/.exec(path);
  if (match && method === "GET") {
    const id = idSchema.parse(match[1]);
    if (match[2] === "live") return json(await matchCenter(sql, id));
    const after = url.searchParams.get("afterSequence") ?? "0";
    if (!/^\d{1,10}$/.test(after)) throw new DomainError(400, "Invalid event cursor");
    const [exists] = await sql`SELECT id FROM matches WHERE id=${id}`;
    if (!exists) throw new DomainError(404, "Match not found");
    const rows = await sql<
      { payload: unknown }[]
    >`SELECT payload FROM match_events WHERE match_id=${id} AND sequence>${Number(after)} ORDER BY sequence LIMIT 101`;
    const page = rows.slice(0, 100).map((r) => eventSchema.parse(r.payload));
    return json({ events: page, nextSequence: rows.length > 100 ? page.at(-1)!.sequence : null });
  }
  return null;
}
