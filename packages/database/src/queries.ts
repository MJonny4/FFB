import type { SQL } from "bun";
import {
  teamSchema,
  teamDetailSchema,
  userSchema,
  matchSchema,
  roundSchema,
  betSchema,
  ledgerSchema,
  standingSchema,
  leaderboardSchema,
  matchCenterSchema,
  publicProfileSchema,
  type LineupInput,
  type Team,
} from "@ffb/contracts";
import { calculateStandings, getActiveSeason, type ResolvedStandingsMatch } from "@ffb/football";
import { DomainError } from "./client.ts";
interface TeamRow {
  id: string;
  profile: Team;
  strength: string;
  username: string | null;
  display_name: string | null;
}
interface LineupRow {
  kind: string;
  payload: LineupInput;
}
interface FixtureRow {
  id: string;
  round_id: string;
  home_id: string;
  away_id: string;
  scheduled_at: Date;
  lineup_locks_at: Date;
  status: string;
  result: unknown;
  revision: number;
  week_number: number;
  closes_at: Date;
}
interface BetRow {
  id: string;
  match_id: string;
  home_name: string;
  away_name: string;
  market: string;
  selection: string;
  stake: number;
  odds: string;
  status: string;
  payout: string | null;
  created_at: Date;
}
interface LedgerRow {
  id: string;
  type: string;
  amount: string;
  balance_after: string;
  reference: string;
  created_at: Date;
}
interface RankingRow {
  username: string;
  display_name: string;
  balance: string;
  settled: number;
  wins: number;
  losses: number;
  pending: number;
  profit: string;
  stakes: string;
}
export async function teams(sql: SQL) {
  const rows = await sql<
    TeamRow[]
  >`SELECT t.id,t.profile,t.strength,u.username,u.display_name FROM teams t LEFT JOIN users u ON u.id=t.manager_id AND u.deactivated_at IS NULL ORDER BY t.id`;
  return rows.map((r) =>
    teamSchema.parse({
      ...r.profile,
      id: r.id,
      strengthRating: Number(r.strength),
      manager: r.username ? { username: r.username, displayName: r.display_name } : null,
    }),
  );
}
export async function user(sql: SQL, id: string) {
  const [u] =
    await sql`SELECT u.id,u.email,u.username,u.display_name,u.balance,u.verified_at,u.avatar IS NOT NULL AS has_avatar,t.id AS team_id FROM users u LEFT JOIN teams t ON t.manager_id=u.id WHERE u.id=${id} AND u.deactivated_at IS NULL`;
  if (!u) throw new DomainError(401, "Please sign in");
  return userSchema.parse({
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.display_name,
    coinBalance: Number(u.balance),
    verified: !!u.verified_at,
    teamId: u.team_id,
    avatarUrl: u.has_avatar ? `/api/users/${u.username}/avatar` : null,
  });
}
export async function teamDetail(sql: SQL, teamId: string, userId?: string) {
  const all = await teams(sql);
  const team = all.find((t) => t.id === teamId || t.slug === teamId);
  if (!team) throw new DomainError(404, "Club not found");
  const players = await sql<
    { payload: unknown }[]
  >`SELECT payload FROM players WHERE team_id=${team.id} ORDER BY shirt_number`;
  const lineups = await sql<LineupRow[]>`SELECT kind,payload FROM lineups WHERE team_id=${team.id}`;
  const [owner] = await sql`SELECT manager_id FROM teams WHERE id=${team.id}`;
  const privateView = !!userId && owner?.manager_id === userId;
  return teamDetailSchema.parse({
    ...team,
    squad: players.map((r) => r.payload),
    official: lineups.find((l) => l.kind === "official")?.payload,
    alternatives: privateView
      ? lineups.filter((l) => l.kind === "alternative").map((l) => l.payload)
      : [],
    draft: privateView ? (lineups.find((l) => l.kind === "draft")?.payload ?? null) : null,
  });
}
export async function matches(
  sql: SQL,
  options: { id?: string; roundId?: string; teamId?: string; before?: string; limit?: number } = {},
) {
  const all = await teams(sql);
  const byId = new Map(all.map((t) => [t.id, t]));
  const rows = await sql<
    FixtureRow[]
  >`SELECT m.id,m.round_id,m.home_id,m.away_id,m.scheduled_at,m.lineup_locks_at,m.status,m.result,m.revision,r.week_number,r.closes_at FROM matches m JOIN rounds r ON r.id=m.round_id WHERE (${options.id ?? null}::text IS NULL OR m.id=${options.id ?? null}) AND (${options.roundId ?? null}::text IS NULL OR m.round_id=${options.roundId ?? null}) AND (${options.teamId ?? null}::text IS NULL OR m.home_id=${options.teamId ?? null} OR m.away_id=${options.teamId ?? null}) AND (${options.before ?? null}::timestamptz IS NULL OR m.scheduled_at<${options.before ?? null}::timestamptz) ORDER BY m.scheduled_at DESC,m.id LIMIT ${options.limit ?? 100}`;
  return Promise.all(
    rows.map(async (r) => {
      const quotes =
        await sql`SELECT market,selection,odds::text FROM odds WHERE match_id=${r.id} AND revision=(SELECT max(revision) FROM odds WHERE match_id=${r.id}) ORDER BY market,selection`;
      return matchSchema.parse({
        id: r.id,
        roundId: r.round_id,
        weekNumber: r.week_number,
        scheduledAt: r.scheduled_at.toISOString(),
        lineupLocksAt: r.lineup_locks_at.toISOString(),
        bettingClosesAt: r.closes_at.toISOString(),
        status: r.status,
        result: r.result,
        revision: r.revision,
        homeTeam: byId.get(r.home_id),
        awayTeam: byId.get(r.away_id),
        quotes,
      });
    }),
  );
}
export async function currentRound(sql: SQL) {
  const [r] =
    await sql`SELECT id,week_number,status,opens_at,closes_at FROM rounds ORDER BY week_number DESC LIMIT 1`;
  if (!r) return null;
  return roundSchema.parse({
    id: r.id,
    weekNumber: r.week_number,
    status: r.status,
    opensAt: r.opens_at.toISOString(),
    bettingClosesAt: r.closes_at.toISOString(),
    matches: await matches(sql, { roundId: r.id }),
  });
}
export async function matchCenter(sql: SQL, id: string) {
  // Snapshot transaction prevents mixing a newer revision with older event history.
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const [match] = await matches(tx, { id });
    if (!match) throw new DomainError(404, "Match not found");
    const [checkpoint] =
      await tx`SELECT m.state,coalesce(m.input#>>'{home,formation}',h.payload->>'formation') AS home_formation,coalesce(m.input#>>'{away,formation}',a.payload->>'formation') AS away_formation FROM matches m JOIN lineups h ON h.team_id=m.home_id AND h.kind='official' JOIN lineups a ON a.team_id=m.away_id AND a.kind='official' WHERE m.id=${id}`;
    const rows = await tx<
      { payload: unknown }[]
    >`SELECT payload FROM match_events WHERE match_id=${id} ORDER BY sequence DESC LIMIT 100`;
    return matchCenterSchema.parse({
      match,
      formations: { home: checkpoint.home_formation, away: checkpoint.away_formation },
      live: checkpoint.state,
      events: rows.reverse().map((r) => r.payload),
    });
  });
}
export async function bets(sql: SQL, userId: string) {
  const rows = await sql<
    BetRow[]
  >`SELECT b.id,b.match_id,h.profile->>'name' AS home_name,a.profile->>'name' AS away_name,b.stake,b.status,b.payout,b.created_at,o.market,o.selection,o.odds::text FROM bets b JOIN odds o ON o.id=b.quote_id JOIN matches m ON m.id=b.match_id JOIN teams h ON h.id=m.home_id JOIN teams a ON a.id=m.away_id WHERE b.user_id=${userId} ORDER BY b.created_at DESC LIMIT 100`;
  return rows.map((r) =>
    betSchema.parse({
      id: r.id,
      matchId: r.match_id,
      homeTeamName: r.home_name,
      awayTeamName: r.away_name,
      market: r.market,
      selection: r.selection,
      stake: r.stake,
      oddsTaken: r.odds,
      status: r.status,
      payout: r.payout === null ? null : Number(r.payout),
      createdAt: r.created_at.toISOString(),
    }),
  );
}
export async function ledger(sql: SQL, userId: string) {
  const rows = await sql<
    LedgerRow[]
  >`SELECT id,type,amount,balance_after,reference,created_at FROM ledger WHERE user_id=${userId} ORDER BY created_at DESC LIMIT 100`;
  return rows.map((r) =>
    ledgerSchema.parse({
      id: r.id,
      type: r.type,
      amount: Number(r.amount),
      balanceAfter: Number(r.balance_after),
      reference: r.reference,
      createdAt: r.created_at.toISOString(),
    }),
  );
}
export async function standings(sql: SQL) {
  const all = await teams(sql);
  const [latest] = await sql`SELECT max(week_number) AS week FROM rounds`;
  const active = getActiveSeason(latest.week);
  const rows = await sql<
    ResolvedStandingsMatch[]
  >`SELECT m.id,r.week_number AS "weekNumber",m.scheduled_at AS "scheduledAt",m.resolved_at AS "resolvedAt",m.home_id AS "homeTeamId",m.away_id AS "awayTeamId",m.result AS "resultPayload" FROM matches m JOIN rounds r ON r.id=m.round_id WHERE m.status='RESOLVED' AND r.week_number BETWEEN ${active.firstWeekNumber} AND ${active.lastWeekNumber}`;
  const calculation = calculateStandings(all, rows);
  return calculation.entries.map((e) =>
    standingSchema.parse({ ...e, team: all.find((t) => t.id === e.team.id) }),
  );
}
export async function leaderboard(sql: SQL) {
  const rows = await sql<
    RankingRow[]
  >`SELECT u.username,u.display_name,u.balance,count(b.id) FILTER(WHERE b.status IN ('WON','LOST'))::int AS settled,count(b.id) FILTER(WHERE b.status='WON')::int AS wins,count(b.id) FILTER(WHERE b.status='LOST')::int AS losses,count(b.id) FILTER(WHERE b.status='PENDING')::int AS pending,coalesce(sum(b.payout-b.stake) FILTER(WHERE b.status IN ('WON','LOST')),0) AS profit,coalesce(sum(b.stake) FILTER(WHERE b.status IN ('WON','LOST')),0) AS stakes FROM users u LEFT JOIN bets b ON b.user_id=u.id WHERE u.deactivated_at IS NULL GROUP BY u.id ORDER BY profit DESC,u.balance DESC,u.username`;
  return rows.map((r, i) =>
    leaderboardSchema.parse({
      rank: i + 1,
      username: r.username,
      displayName: r.display_name,
      coinBalance: Number(r.balance),
      settledBets: r.settled,
      wins: r.wins,
      losses: r.losses,
      pendingBets: r.pending,
      netProfit: Number(r.profit),
      roiPercent: Number(r.stakes) ? (Number(r.profit) / Number(r.stakes)) * 100 : null,
      hitRatePercent: r.settled ? (r.wins / r.settled) * 100 : null,
      provisional: r.settled < 10,
    }),
  );
}
export async function publicProfile(sql: SQL, username: string) {
  const [u] =
    await sql`SELECT username,display_name,avatar IS NOT NULL AS has_avatar FROM users WHERE username=${username} AND deactivated_at IS NULL`;
  if (!u) throw new DomainError(404, "Manager not found");
  return publicProfileSchema.parse({
    username: u.username,
    displayName: u.display_name,
    avatarUrl: u.has_avatar ? `/api/users/${u.username}/avatar` : null,
    team: (await teams(sql)).find((t) => t.manager?.username === u.username) ?? null,
  });
}
export type StoredLineup = LineupInput;
