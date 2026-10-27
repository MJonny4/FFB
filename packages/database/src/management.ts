import type { SQL } from "bun";
import { lineupInput, type LineupInput } from "@ffb/contracts";
import { calculateLineupRatings, createOddsQuotes, type GeneratedPlayer } from "@ffb/football";
import { DomainError, uid } from "./client.ts";
export async function claimTeam(sql: SQL, userId: string, teamId: string) {
  return sql.begin(async (tx) => {
    await tx`SELECT id FROM matches WHERE status='SCHEDULED' AND (home_id=${teamId} OR away_id=${teamId}) ORDER BY id FOR UPDATE`;
    await tx`SELECT id FROM teams WHERE id=${teamId} FOR UPDATE`;
    const [active] =
      await tx`SELECT id FROM users WHERE id=${userId} AND deactivated_at IS NULL FOR UPDATE`;
    if (!active) throw new DomainError(401, "Please sign in");
    const [own] = await tx`SELECT id FROM teams WHERE manager_id=${userId}`;
    if (own) throw new DomainError(409, "You already manage a club");
    const [pending] =
      await tx`SELECT b.id FROM bets b JOIN matches m ON m.id=b.match_id WHERE b.user_id=${userId} AND b.status='PENDING' AND (m.home_id=${teamId} OR m.away_id=${teamId}) LIMIT 1`;
    if (pending)
      throw new DomainError(409, "Cancel your pending bets on this club before claiming");
    const result =
      await tx`UPDATE teams SET manager_id=${userId} WHERE id=${teamId} AND manager_id IS NULL RETURNING id`;
    if (!result.length) throw new DomainError(409, "Club is unavailable");
    return { claimed: true };
  });
}
export async function saveDraft(sql: SQL, userId: string, input: LineupInput) {
  return sql.begin(async (tx) => {
    const [team] = await tx`SELECT id FROM teams WHERE manager_id=${userId} FOR UPDATE`;
    if (!team) throw new DomainError(404, "Claim a club first");
    const [active] =
      await tx`SELECT id FROM users WHERE id=${userId} AND deactivated_at IS NULL FOR UPDATE`;
    if (!active) throw new DomainError(401, "Please sign in");
    const players = await tx<
      { payload: GeneratedPlayer }[]
    >`SELECT payload FROM players WHERE team_id=${team.id}`;
    calculateLineupRatings(
      input.formation,
      input.assignments.map((a) => {
        const player = players.find((p) => p.payload.id === a.playerId)?.payload;
        if (!player) throw new DomainError(400, "Player does not belong to this club");
        return { slotKey: a.slotKey, player };
      }),
    );
    await tx`INSERT INTO lineups(id,team_id,kind,payload) VALUES(${uid()},${team.id},'draft',${tx.json(input)}) ON CONFLICT(team_id,kind) WHERE kind<>'alternative' DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`;
    return { saved: true };
  });
}
export async function publishDraft(sql: SQL, userId: string) {
  const [candidate] = await sql`SELECT id FROM teams WHERE manager_id=${userId}`;
  if (!candidate) throw new DomainError(404, "Claim a club first");
  return sql.begin(async (tx) => {
    const fixtures = await tx<
      { id: string; home_id: string; away_id: string; lineup_locks_at: Date; input: unknown }[]
    >`SELECT id,home_id,away_id,lineup_locks_at,input FROM matches WHERE status='SCHEDULED' AND (home_id=${candidate.id} OR away_id=${candidate.id}) ORDER BY id FOR UPDATE`;
    const [team] =
      await tx`SELECT id FROM teams WHERE id=${candidate.id} AND manager_id=${userId} FOR UPDATE`;
    if (!team) throw new DomainError(403, "Club ownership changed");
    const [active] =
      await tx`SELECT id FROM users WHERE id=${userId} AND deactivated_at IS NULL FOR UPDATE`;
    if (!active) throw new DomainError(401, "Please sign in");
    const [clock] = await tx`SELECT clock_timestamp() AS now`;
    if (fixtures.some((f) => clock.now >= f.lineup_locks_at))
      throw new DomainError(409, "Lineup is locked until your fixture finishes");
    const [draft] =
      await tx`SELECT payload FROM lineups WHERE team_id=${team.id} AND kind='draft' FOR UPDATE`;
    if (!draft) throw new DomainError(409, "Save a draft first");
    const input = lineupInput.parse(draft.payload);
    const players = await tx<
      { payload: GeneratedPlayer }[]
    >`SELECT payload FROM players WHERE team_id=${team.id}`;
    const ratings = calculateLineupRatings(
      input.formation,
      input.assignments.map((a) => ({
        slotKey: a.slotKey,
        player: players.find((p) => p.payload.id === a.playerId)!.payload,
      })),
    );
    await tx`UPDATE lineups SET payload=${tx.json(input)},updated_at=now() WHERE team_id=${team.id} AND kind='official'`;
    await tx`UPDATE teams SET strength=${ratings.overall} WHERE id=${team.id}`;
    for (const f of fixtures) {
      if (f.input) continue;
      const sides = await tx<
        { id: string; strength: string }[]
      >`SELECT id,strength FROM teams WHERE id IN(${f.home_id},${f.away_id})`;
      const [revision] =
        await tx`SELECT coalesce(max(revision),-1)+1 AS n FROM odds WHERE match_id=${f.id}`;
      for (const q of createOddsQuotes(
        Number(sides.find((t) => t.id === f.home_id)!.strength),
        Number(sides.find((t) => t.id === f.away_id)!.strength),
      ))
        await tx`INSERT INTO odds(id,match_id,market,selection,odds,revision) VALUES(${uid()},${f.id},${q.market},${q.selection},${q.odds.toFixed(4)},${revision.n})`;
    }
    return { published: true };
  });
}
