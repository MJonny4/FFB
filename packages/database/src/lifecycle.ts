import type { SQL, TransactionSQL } from "bun";
import {
  createOddsQuotes,
  getRoundSchedule,
  roundCalendar,
  LIVE_ENGINE_VERSION,
  SIMULATION_STEP_MS,
  gradeBet,
  calculatePayout,
  type GeneratedPlayer,
  type SimulationInput,
  type SimulationState,
} from "@ffb/football";
import {
  initializeSimulation,
  stepSimulation,
  simulationResult,
  freezeTeam,
} from "@ffb/simulation";
import { lineupInput } from "@ffb/contracts";
import { uid } from "./client.ts";
import { wallet } from "./wallet.ts";
export async function schedule(
  tx: TransactionSQL,
  id: string,
  kind: string,
  entityId: string,
  at: Date,
) {
  await tx`INSERT INTO jobs(id,kind,entity_id,run_at) VALUES(${id},${kind},${entityId},${at}) ON CONFLICT(id) DO NOTHING`;
}
export async function ensureRound(tx: TransactionSQL, now: Date) {
  await tx`SELECT pg_advisory_xact_lock(72411003)`;
  const calendar = roundCalendar(now);
  const next = now < calendar.opensAt ? calendar.opensAt : calendar.nextOpen;
  await schedule(tx, `open:${next.toISOString()}`, "open", "calendar", next);
  if (now < calendar.opensAt || now >= calendar.closesAt) return;
  const [existing] = await tx`SELECT id FROM rounds WHERE lifecycle_key=${calendar.key}`;
  if (existing) return;
  const clubs = await tx<
    { id: string; strength: string }[]
  >`SELECT id,strength FROM teams ORDER BY id`;
  if (clubs.length !== 20) throw new Error("Exactly 20 seeded clubs required");
  const [latest] = await tx`SELECT coalesce(max(week_number),0)+1 AS week FROM rounds`;
  const id = uid();
  await tx`INSERT INTO rounds(id,week_number,lifecycle_key,opens_at,closes_at,status) VALUES(${id},${latest.week},${calendar.key},${calendar.opensAt},${calendar.closesAt},'OPEN')`;
  let seed = latest.week * 48271;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  for (const pair of getRoundSchedule(clubs, latest.week, { random })) {
    const matchId = uid(),
      kickoff = calendar.kickoff(pair.scheduledDay, pair.scheduledMinuteOfDay),
      lock = new Date(+kickoff - 3600000);
    await tx`INSERT INTO matches(id,round_id,home_id,away_id,scheduled_at,lineup_locks_at,seed,engine_version) VALUES(${matchId},${id},${pair.homeTeamId},${pair.awayTeamId},${kickoff},${lock},${uid()},${LIVE_ENGINE_VERSION})`;
    for (const q of createOddsQuotes(
      Number(pair.homeTeam.strength),
      Number(pair.awayTeam.strength),
    ))
      await tx`INSERT INTO odds(id,match_id,market,selection,odds,revision) VALUES(${uid()},${matchId},${q.market},${q.selection},${q.odds.toFixed(4)},0)`;
    await schedule(tx, `lock:${matchId}`, "lock", matchId, lock);
    await schedule(tx, `tick:${matchId}:0`, "tick", matchId, kickoff);
  }
  await schedule(tx, `close:${id}`, "close", id, calendar.closesAt);
  const users = await tx`SELECT id FROM users WHERE deactivated_at IS NULL ORDER BY id`;
  for (const u of users) await wallet(tx, u.id, "TOPUP", 200, `round:${id}:topup`);
}
async function lockFixture(tx: TransactionSQL, id: string) {
  const [m] =
    await tx`SELECT id,home_id,away_id,input,engine_version FROM matches WHERE id=${id} FOR UPDATE`;
  if (!m || m.input) return;
  const frozen = [];
  for (const teamId of [m.home_id, m.away_id]) {
    const [team] = await tx`SELECT id,profile FROM teams WHERE id=${teamId}`;
    const [l] = await tx`SELECT payload FROM lineups WHERE team_id=${teamId} AND kind='official'`;
    const lineup = lineupInput.parse(l.payload);
    const players = await tx<
      { payload: GeneratedPlayer }[]
    >`SELECT payload FROM players WHERE team_id=${teamId} ORDER BY id`;
    frozen.push(
      freezeTeam(
        { id: team.id, name: team.profile.name },
        lineup.formation,
        lineup.assignments,
        players.map((p) => p.payload),
      ),
    );
  }
  const input: SimulationInput = {
    version: LIVE_ENGINE_VERSION,
    matchId: id,
    home: frozen[0]!,
    away: frozen[1]!,
  };
  if (m.engine_version !== input.version) throw new Error("Unavailable engine version");
  await tx`UPDATE matches SET input=${tx.json(input)} WHERE id=${id}`;
}
export async function settle(tx: TransactionSQL, id: string, state: SimulationState) {
  const result = simulationResult(state);
  const [m] = await tx`SELECT status,round_id FROM matches WHERE id=${id} FOR UPDATE`;
  if (m.status === "RESOLVED") return false;
  const pending =
    await tx`SELECT b.id,b.user_id,b.stake,o.market,o.selection,o.odds::text FROM bets b JOIN odds o ON o.id=b.quote_id WHERE b.match_id=${id} AND b.status='PENDING' ORDER BY b.user_id,b.id`;
  for (const b of pending) {
    const won = gradeBet(b.market, b.selection, result),
      payout = won ? calculatePayout(b.stake, b.odds) : 0;
    await tx`UPDATE bets SET status=${won ? "WON" : "LOST"},payout=${payout} WHERE id=${b.id} AND status='PENDING'`;
    if (payout) await wallet(tx, b.user_id, "PAYOUT", payout, `bet:${b.id}:payout`);
  }
  await tx`UPDATE matches SET status='RESOLVED',result=${tx.json(result)},resolved_at=clock_timestamp() WHERE id=${id}`;
  await tx`UPDATE rounds SET status='SETTLED' WHERE id=${m.round_id} AND NOT EXISTS(SELECT 1 FROM matches WHERE round_id=${m.round_id} AND status<>'RESOLVED')`;
  return true;
}
export async function tick(tx: TransactionSQL, id: string, now: Date) {
  await lockFixture(tx, id);
  const [m] =
    await tx`SELECT id,input,seed,state,revision,status,scheduled_at FROM matches WHERE id=${id} FOR UPDATE`;
  if (!m || m.status === "RESOLVED" || now < m.scheduled_at) return;
  const input = m.input as SimulationInput;
  let state: SimulationState = m.state ?? initializeSimulation(input, m.seed);
  // Catch up persisted wall-clock progress in bounded batches, independent of spectators.
  const target = Math.floor((+now - +m.scheduled_at) / SIMULATION_STEP_MS) + 1;
  const count = Math.max(0, Math.min(240, target - state.step));
  for (let i = 0; i < count && state.phase !== "FINISHED"; i++) {
    const next = stepSimulation(input, state);
    state = next.state;
    for (const event of next.events)
      await tx`INSERT INTO match_events(match_id,sequence,payload) VALUES(${id},${event.sequence},${tx.json(event)}) ON CONFLICT DO NOTHING`;
  }
  const revision = m.revision + 1;
  await tx`UPDATE matches SET state=${tx.json(state)},revision=${revision} WHERE id=${id}`;
  if (state.phase === "FINISHED") await settle(tx, id, state);
  else
    await schedule(
      tx,
      `tick:${id}:${state.step}`,
      "tick",
      id,
      new Date(+m.scheduled_at + state.step * SIMULATION_STEP_MS),
    );
  return { matchId: id, revision };
}
export async function recover(sql: SQL, now = new Date()) {
  await sql.begin(async (tx) => {
    await ensureRound(tx, now);
    const fixtures =
      await tx`SELECT id,lineup_locks_at,scheduled_at,state FROM matches WHERE status='SCHEDULED'`;
    for (const f of fixtures) {
      await schedule(tx, `lock:${f.id}`, "lock", f.id, f.lineup_locks_at);
      await schedule(
        tx,
        `tick:${f.id}:${f.state?.step ?? 0}`,
        "tick",
        f.id,
        new Date(+f.scheduled_at + (f.state?.step ?? 0) * SIMULATION_STEP_MS),
      );
    }
    const rounds = await tx`SELECT id,closes_at FROM rounds WHERE status='OPEN'`;
    for (const r of rounds) await schedule(tx, `close:${r.id}`, "close", r.id, r.closes_at);
  });
}
export async function runNextJob(sql: SQL, now = new Date()) {
  let jobId: string | undefined;
  try {
    return await sql.begin(async (tx) => {
      // One lifecycle writer prevents cross-round user-lock inversion; API remains concurrent.
      const [lock] = await tx`SELECT pg_try_advisory_xact_lock(72411004) AS acquired`;
      if (!lock.acquired) return null;
      const [job] =
        await tx`SELECT id,kind,entity_id FROM jobs WHERE done_at IS NULL AND run_at<=${now} ORDER BY run_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!job) return null;
      jobId = job.id;
      let change: { matchId: string; revision: number } | undefined;
      if (job.kind === "open") await ensureRound(tx, now);
      if (job.kind === "close")
        await tx`UPDATE rounds SET status='CLOSED' WHERE id=${job.entity_id} AND status='OPEN' AND closes_at<=${now}`;
      if (job.kind === "lock") await lockFixture(tx, job.entity_id);
      if (job.kind === "tick") change = await tick(tx, job.entity_id, now);
      await tx`UPDATE jobs SET done_at=clock_timestamp(),last_error=NULL WHERE id=${job.id}`;
      return change ?? { matchId: null, revision: 0 };
    });
  } catch (error) {
    if (jobId)
      await sql`UPDATE jobs SET attempts=attempts+1,last_error='Job failed; inspect worker diagnostics',run_at=clock_timestamp()+least(300,power(2,least(attempts+1,8))) * interval '1 second' WHERE id=${jobId} AND done_at IS NULL`;
    throw error;
  }
}
