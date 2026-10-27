import type { SQL } from "bun";
import type { BetInput } from "@ffb/contracts";
import { DomainError, uid } from "./client.ts";
import { wallet } from "./wallet.ts";
export async function placeBet(sql: SQL, userId: string, input: BetInput) {
  return sql.begin(async (tx) => {
    const [m] =
      await tx`SELECT m.id,m.home_id,m.away_id,m.status,m.state,m.scheduled_at,r.closes_at,r.opens_at,r.status AS round_status FROM matches m JOIN rounds r ON r.id=m.round_id WHERE m.id=${input.matchId} FOR UPDATE OF m`;
    if (!m) throw new DomainError(404, "Match not found");
    const [u] =
      await tx`SELECT id FROM users WHERE id=${userId} AND deactivated_at IS NULL FOR UPDATE`;
    if (!u) throw new DomainError(401, "Please sign in");
    const [existing] =
      await tx`SELECT b.id,b.match_id,b.stake,o.market,o.selection FROM bets b JOIN odds o ON o.id=b.quote_id WHERE b.user_id=${userId} AND b.request_id=${input.requestId}`;
    if (existing) {
      if (
        existing.match_id !== input.matchId ||
        existing.stake !== input.stake ||
        existing.market !== input.market ||
        existing.selection !== input.selection
      )
        throw new DomainError(409, "Idempotency key already used");
      return { betId: existing.id, coinBalance: await balance(tx, userId) };
    }
    const [clock] = await tx`SELECT clock_timestamp() AS now`;
    if (
      m.status !== "SCHEDULED" ||
      m.state ||
      m.round_status !== "OPEN" ||
      clock.now < m.opens_at ||
      clock.now >= m.closes_at ||
      clock.now >= m.scheduled_at
    )
      throw new DomainError(409, "Betting is closed");
    const [manager] =
      await tx`SELECT id FROM teams WHERE manager_id=${userId} AND id IN(${m.home_id},${m.away_id})`;
    if (manager) throw new DomainError(409, "Managers cannot bet on their own club");
    const [quote] =
      await tx`SELECT id FROM odds WHERE match_id=${m.id} AND market=${input.market} AND selection=${input.selection} ORDER BY revision DESC LIMIT 1`;
    if (!quote) throw new DomainError(409, "Quote unavailable");
    const id = uid();
    await tx`INSERT INTO bets(id,user_id,match_id,quote_id,request_id,stake) VALUES(${id},${userId},${m.id},${quote.id},${input.requestId},${input.stake})`;
    return {
      betId: id,
      coinBalance: await wallet(tx, userId, "STAKE", -input.stake, `bet:${id}:stake`),
    };
  });
}
async function balance(sql: SQL, userId: string) {
  const [u] = await sql`SELECT balance FROM users WHERE id=${userId}`;
  return Number(u.balance);
}
export async function cancelBet(sql: SQL, userId: string, betId: string) {
  const [candidate] = await sql`SELECT match_id FROM bets WHERE id=${betId} AND user_id=${userId}`;
  if (!candidate) throw new DomainError(404, "Bet not found");
  return sql.begin(async (tx) => {
    const [m] =
      await tx`SELECT m.status,m.state,m.scheduled_at,r.closes_at,r.opens_at,r.status AS round_status FROM matches m JOIN rounds r ON r.id=m.round_id WHERE m.id=${candidate.match_id} FOR UPDATE OF m`;
    await tx`SELECT id FROM users WHERE id=${userId} FOR UPDATE`;
    const [b] =
      await tx`SELECT status,stake FROM bets WHERE id=${betId} AND user_id=${userId} FOR UPDATE`;
    if (b.status === "CANCELLED") return { coinBalance: await balance(tx, userId) };
    const [clock] = await tx`SELECT clock_timestamp() AS now`;
    if (
      b.status !== "PENDING" ||
      m.status !== "SCHEDULED" ||
      m.state ||
      m.round_status !== "OPEN" ||
      clock.now < m.opens_at ||
      clock.now >= m.closes_at ||
      clock.now >= m.scheduled_at
    )
      throw new DomainError(409, "Cancellation is closed");
    await tx`UPDATE bets SET status='CANCELLED' WHERE id=${betId}`;
    return { coinBalance: await wallet(tx, userId, "REFUND", b.stake, `bet:${betId}:refund`) };
  });
}
