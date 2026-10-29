import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { SQL, RedisClient } from "bun";
import { migrate } from "../packages/database/src/migrate.ts";
import { seed } from "../packages/database/src/seed.ts";
import {
  database,
  teams,
  currentRound,
  placeBet,
  cancelBet,
  signup,
  login,
  session,
  consumeToken,
  user,
  hash,
  matchCenter,
  runNextJob,
  recover,
  claimTeam,
  saveDraft,
  publishDraft,
  teamDetail,
  standings,
  ledger,
  requestToken,
  changePassword,
  deactivate,
  publicProfile,
  settle,
  ensureRound,
} from "@ffb/database";
import { calculatePayout, roundCalendar, type SimulationState } from "@ffb/football";
import { loadConfig } from "@ffb/config";
import { startApi } from "../apps/api/src/server.ts";
import { startWorker } from "../apps/worker/src/worker.ts";
import { deliverMail } from "../apps/worker/src/mail.ts";
import type { Config } from "@ffb/config";
const enabled = process.env.RUN_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
suite("isolated local PostgreSQL / Redis integration", () => {
  let admin: SQL, sql: SQL, config: Config, api: ReturnType<typeof startApi>;
  let first: { userId: string; token: string }, second: { userId: string; token: string };
  let matchId: string;
  const dbName = `ffb_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const password = "a-long-test-password";
  let base: Config;
  let url: URL;
  beforeAll(async () => {
    base = loadConfig();
    url = new URL(base.DATABASE_URL);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error("Integration tests require local PostgreSQL");
    admin = database(base.DATABASE_URL);
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    url.pathname = `/${dbName}`;
    config = {
      ...base,
      NODE_ENV: "test",
      DATABASE_URL: url.toString(),
      DIRECT_DATABASE_URL: undefined,
      MAIL_MODE: "capture",
      WEB_ORIGIN: "http://localhost:5173",
    };
    sql = database(config.DATABASE_URL);
    await migrate(sql);
    await migrate(sql);
    await seed(sql);
    await seed(sql);
    await sql.begin((tx) => ensureRound(tx, roundCalendar(new Date()).nextOpen));
    await sql`UPDATE rounds SET opens_at=now()-interval '1 day',closes_at=now()+interval '2 days' WHERE week_number=(SELECT max(week_number) FROM rounds)`;
    first = await signup(
      sql,
      { email: "first@example.test", username: "first_manager", displayName: "First", password },
      config.WEB_ORIGIN,
    );
    second = await signup(
      sql,
      { email: "second@example.test", username: "second_manager", displayName: "Second", password },
      config.WEB_ORIGIN,
    );
    matchId = (await currentRound(sql))!.matches[0]!.id;
    api = startApi(config, 0);
  }, 30000);
  afterAll(async () => {
    if (api) await api.close();
    if (sql) await sql.close();
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.close();
    }
  });
  const request = async (path: string, init: RequestInit = {}, token = first.token) => {
    const headers = new Headers(init.headers);
    headers.set("Origin", config.WEB_ORIGIN);
    headers.set("X-FFB-Client", "web");
    headers.set("Cookie", `ffb_session=${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    return fetch(`http://localhost:${api.server.port}${path}`, { ...init, headers });
  };
  test("repeatable migration and seed preserve all fictional data", async () => {
    expect(await teams(sql)).toHaveLength(20);
    const [count] = await sql`SELECT count(*)::int AS n FROM players`;
    expect(count.n).toBe(460);
    expect((await currentRound(sql))!.matches).toHaveLength(10);
  });
  test("opaque sessions hash tokens; verification is single use; login is safe", async () => {
    expect((await session(sql, first.token))?.userId).toBe(first.userId);
    expect(await session(sql, "invalid")).toBeNull();
    const [mail] = await sql`SELECT body FROM mail_outbox WHERE user_id=${first.userId}`;
    const token = /token=([a-f0-9]{64})/.exec(mail.body)![1]!;
    await consumeToken(sql, token, "verify");
    expect((await user(sql, first.userId)).verified).toBe(true);
    await expect(consumeToken(sql, token, "verify")).rejects.toThrow();
    expect((await login(sql, "first@example.test", password)).userId).toBe(first.userId);
    await expect(login(sql, "unknown@example.test", password)).rejects.toThrow(
      "Email or password is incorrect",
    );
    const [stored] =
      await sql`SELECT token_hash FROM sessions WHERE token_hash=${hash(first.token)}`;
    expect(stored.token_hash).not.toBe(first.token);
  });
  test("acceptance prevents double-spending and retries reuse accepted bet", async () => {
    const requestId = crypto.randomUUID(),
      input = {
        matchId,
        market: "MATCH_RESULT" as const,
        selection: "HOME",
        stake: 800,
        requestId,
      };
    const results = await Promise.allSettled([
      placeBet(sql, first.userId, input),
      placeBet(sql, first.userId, { ...input, requestId: crypto.randomUUID() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await user(sql, first.userId)).coinBalance).toBe(200);
    const accepted = results.find((r) => r.status === "fulfilled");
    expect(accepted?.status).toBe("fulfilled");
    if (results[0]?.status === "fulfilled")
      expect((await placeBet(sql, first.userId, input)).betId).toBe(results[0].value.betId);
    const [sum] =
      await sql`SELECT sum(amount)::text AS n FROM ledger WHERE user_id=${first.userId}`;
    expect(Number(sum.n)).toBe(200);
  });
  test("concurrent identical requests debit once and database rejects unaudited writes", async () => {
    const input = {
      matchId,
      market: "MATCH_RESULT" as const,
      selection: "AWAY",
      stake: 1,
      requestId: crypto.randomUUID(),
    };
    const accepted = await Promise.all(
      Array.from({ length: 4 }, () => placeBet(sql, first.userId, input)),
    );
    expect(new Set(accepted.map((b) => b.betId)).size).toBe(1);
    expect((await user(sql, first.userId)).coinBalance).toBe(199);
    await cancelBet(sql, first.userId, accepted[0]!.betId);
    expect((await user(sql, first.userId)).coinBalance).toBe(200);
    await expect(sql`UPDATE users SET balance=balance+10 WHERE id=${first.userId}`).rejects.toThrow(
      "Wallet and ledger differ",
    );
    await expect(sql`UPDATE users SET balance=-1 WHERE id=${first.userId}`).rejects.toThrow();
  });
  test("password reset and password change revoke old sessions", async () => {
    await requestToken(sql, "reset", config.WEB_ORIGIN, { email: "first@example.test" });
    const [mail] =
      await sql`SELECT body FROM mail_outbox WHERE user_id=${first.userId} AND subject='Reset your FFB password' ORDER BY run_at DESC LIMIT 1`;
    const token = /token=([a-f0-9]{64})/.exec(mail.body)![1]!;
    const result = await consumeToken(sql, token, "reset", "a-new-test-password");
    expect(await session(sql, first.token)).toBeNull();
    first.token = result.token!;
    await expect(consumeToken(sql, token, "reset", password)).rejects.toThrow();
    const next = await changePassword(sql, first.userId, "a-new-test-password", password);
    expect(await session(sql, first.token)).toBeNull();
    first.token = next;
    await sql`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=${hash(first.token)}`;
    expect(await session(sql, first.token)).toBeNull();
    first.token = (await login(sql, "first@example.test", password)).token;
  });
  test("request-id conflict and concurrent cancellation never duplicate refunds", async () => {
    const input = {
      matchId,
      market: "MATCH_RESULT" as const,
      selection: "DRAW",
      stake: 10,
      requestId: crypto.randomUUID(),
    };
    const bet = await placeBet(sql, second.userId, input);
    await expect(placeBet(sql, second.userId, { ...input, stake: 11 })).rejects.toThrow(
      "Idempotency",
    );
    await Promise.all([
      cancelBet(sql, second.userId, bet.betId),
      cancelBet(sql, second.userId, bet.betId),
    ]);
    expect((await user(sql, second.userId)).coinBalance).toBe(1000);
    const [refunds] =
      await sql`SELECT count(*)::int AS n FROM ledger WHERE reference=${`bet:${bet.betId}:refund`}`;
    expect(refunds.n).toBe(1);
  });
  test("stale odds never debit the wallet and accepted receipts survive quote changes", async () => {
    const match = (await currentRound(sql))!.matches.find((m) => m.id === matchId)!;
    const quote = match.quotes.find((q) => q.market === "MATCH_RESULT" && q.selection === "DRAW")!;
    const input = {
      matchId,
      market: quote.market,
      selection: quote.selection,
      stake: 7,
      requestId: crypto.randomUUID(),
      expectedOdds: quote.odds,
    };
    const before = (await user(sql, first.userId)).coinBalance;
    const stale = await request("/api/bets", {
      method: "POST",
      body: JSON.stringify({ ...input, expectedOdds: "1.0100" }),
    });
    expect(stale.status).toBe(409);
    expect((await user(sql, first.userId)).coinBalance).toBe(before);
    const response = await request("/api/bets", { method: "POST", body: JSON.stringify(input) });
    expect(response.status).toBe(201);
    const accepted = (await response.json()) as {
      betId: string;
      coinBalance: number;
      oddsTaken: string;
    };
    expect(accepted).toMatchObject({
      matchId,
      market: quote.market,
      selection: quote.selection,
      stake: 7,
      oddsTaken: quote.odds,
      potentialPayout: calculatePayout(7, quote.odds),
      coinBalance: before - 7,
    });
    await sql`INSERT INTO odds(id,match_id,market,selection,odds,revision) SELECT gen_random_uuid()::text,match_id,market,selection,CASE WHEN market=${quote.market} AND selection=${quote.selection} THEN odds+1 ELSE odds END,revision+1 FROM odds WHERE match_id=${matchId} AND revision=(SELECT max(revision) FROM odds WHERE match_id=${matchId})`;
    try {
      const replay = await request("/api/bets", { method: "POST", body: JSON.stringify(input) });
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(accepted);
      const [debits] =
        await sql`SELECT count(*)::int AS n FROM ledger WHERE reference=${`bet:${accepted.betId}:stake`}`;
      expect(debits.n).toBe(1);
    } finally {
      await cancelBet(sql, first.userId, accepted.betId);
    }
  });
  test("an accepted full-wallet bet can be recovered after betting closes", async () => {
    const match = (await currentRound(sql))!.matches.find((m) => m.id === matchId)!;
    const quote = match.quotes.find((q) => q.market === "MATCH_RESULT" && q.selection === "HOME")!;
    const input = {
      matchId,
      market: quote.market,
      selection: quote.selection,
      stake: (await user(sql, first.userId)).coinBalance,
      expectedOdds: quote.odds,
      requestId: crypto.randomUUID(),
    };
    const accepted = await placeBet(sql, first.userId, input);
    expect(accepted.coinBalance).toBe(0);
    const [round] = await sql`SELECT closes_at FROM rounds WHERE id=${match.roundId}`;
    try {
      await sql`UPDATE rounds SET closes_at=now()-interval '1 second' WHERE id=${match.roundId}`;
      const replay = await request("/api/bets", { method: "POST", body: JSON.stringify(input) });
      expect(replay.status).toBe(201);
      expect(await replay.json()).toEqual(accepted);
      const fresh = await request("/api/bets", {
        method: "POST",
        body: JSON.stringify({ ...input, requestId: crypto.randomUUID() }),
      });
      expect(fresh.status).toBe(409);
      expect((await user(sql, first.userId)).coinBalance).toBe(0);
      const [debits] =
        await sql`SELECT count(*)::int AS n FROM ledger WHERE reference=${`bet:${accepted.betId}:stake`}`;
      expect(debits.n).toBe(1);
    } finally {
      await sql`UPDATE rounds SET closes_at=${round.closes_at} WHERE id=${match.roundId}`;
      await cancelBet(sql, first.userId, accepted.betId);
    }
  });
  test("public club endpoints never expose private preparation, even to the owner", async () => {
    const owner = await signup(
      sql,
      {
        email: "private@example.test",
        username: "private_manager",
        displayName: "Private manager",
        password,
      },
      config.WEB_ORIGIN,
    );
    const club = (await teams(sql)).find((team) => !team.manager)!;
    await claimTeam(sql, owner.userId, club.id);
    try {
      const detail = await teamDetail(sql, club.id, owner.userId);
      await saveDraft(sql, owner.userId, detail.alternatives[0]!);
      for (const token of ["", first.token, owner.token]) {
        const response = await request(`/api/teams/${club.id}`, {}, token);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ draft: null, alternatives: [] });
      }
      expect((await teamDetail(sql, club.id)).alternatives).toEqual([]);
      expect((await teamDetail(sql, club.id, first.userId)).draft).toBeNull();
      const privateView = await request("/api/teams/me", {}, owner.token);
      expect(privateView.status).toBe(200);
      expect(await privateView.json()).toMatchObject({
        id: club.id,
        draft: detail.alternatives[0],
        alternatives: detail.alternatives,
      });
      expect((await request("/api/teams/me", {}, "")).status).toBe(401);
      expect(await (await request("/api/teams/me")).json()).toBeNull();
    } finally {
      await deactivate(sql, owner.userId, password);
    }
  });
  test("manager ownership and lineup validation enforce boundaries", async () => {
    const match = (await currentRound(sql))!.matches.find((m) => m.id !== matchId)!;
    await claimTeam(sql, second.userId, match.homeTeam.id);
    await expect(
      placeBet(sql, second.userId, {
        matchId: match.id,
        market: "MATCH_RESULT",
        selection: "HOME",
        stake: 1,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("own club");
    const detail = await teamDetail(sql, match.homeTeam.id, second.userId);
    await saveDraft(sql, second.userId, detail.official);
    await publishDraft(sql, second.userId);
    const other = await teamDetail(sql, match.awayTeam.id);
    await expect(saveDraft(sql, second.userId, other.official)).rejects.toThrow();
    await sql`UPDATE matches SET scheduled_at=now()+interval '30 minutes',lineup_locks_at=now()-interval '30 minutes' WHERE id=${match.id}`;
    await expect(publishDraft(sql, second.userId)).rejects.toThrow("locked");
  });
  test("API contracts, CORS, CSRF, auth, avatar validation and health", async () => {
    expect((await request("/health/live")).status).toBe(200);
    expect((await request("/health/ready")).status).toBe(200);
    const signedOutSession = await request("/api/auth/session", {}, "");
    expect(signedOutSession.status).toBe(200);
    expect(await signedOutSession.json()).toBeNull();
    expect((await request("/api/users/me", {}, "")).status).toBe(401);
    expect(
      (await request("/api/bets", { method: "POST", body: JSON.stringify({ stake: -1 }) })).status,
    ).toBe(400);
    expect(
      (await fetch(`http://localhost:${api.server.port}/api/auth/logout`, { method: "POST" }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(`http://localhost:${api.server.port}/api/teams`, {
          headers: { Origin: "https://attacker.test" },
        })
      ).status,
    ).toBe(403);
    const response = await request("/api/users/me");
    expect(response.status).toBe(200);
    const data = (await response.json()) as { id: string };
    expect(data).not.toHaveProperty("passwordHash");
    const signedInSession = await request("/api/auth/session");
    expect(signedInSession.status).toBe(200);
    expect(((await signedInSession.json()) as { id: string }).id).toBe(data.id);
    const form = new FormData();
    form.set("avatar", new File(["<svg/>"], "bad.png", { type: "image/png" }));
    const bad = await request("/api/users/me/avatar", { method: "POST", body: form });
    expect(bad.status).toBe(400);
    const valid = new FormData();
    valid.set(
      "avatar",
      new File(
        [await Bun.file("apps/web/public/players/default-player.png").arrayBuffer()],
        "portrait.png",
        { type: "image/png" },
      ),
    );
    expect((await request("/api/users/me/avatar", { method: "POST", body: valid })).status).toBe(
      200,
    );
    const avatar = await request("/api/users/first_manager/avatar");
    expect(avatar.headers.get("content-type")).toBe("image/webp");
    expect((await request("/api/users/me/avatar", { method: "DELETE" })).status).toBe(200);
    expect((await request(`/api/matches/${matchId}/live`)).status).toBe(200);
  });
  test("native WebSocket authenticates, validates subscriptions and returns resync revision", async () => {
    const endpoint = `ws://localhost:${api.server.port}/api/ws`;
    const unauthorized = new WebSocket(endpoint, { headers: { Origin: config.WEB_ORIGIN } });
    await new Promise<void>((resolve, reject) => {
      unauthorized.onopen = () => reject(new Error("Unauthorized socket opened"));
      unauthorized.onerror = () => resolve();
    });
    const socket = new WebSocket(endpoint, {
      headers: { Origin: config.WEB_ORIGIN, Cookie: `ffb_session=${first.token}` },
    });
    const received: Record<string, unknown>[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.onerror = () => reject(new Error("Socket failed"));
      socket.onmessage = (e) => {
        const v = JSON.parse(String(e.data));
        received.push(v);
        if (v.type === "ready")
          socket.send(JSON.stringify({ v: 1, type: "subscribe", matchId, afterRevision: 999 }));
        if (v.type === "changed") resolve();
      };
      setTimeout(() => reject(new Error("Socket timeout")), 3000).unref();
    });
    expect(received.at(-1)?.matchId).toBe(matchId);
    expect(received.at(-1)?.revision).toBe(0);
    const closed = new Promise<number>((resolve) => {
      socket.onclose = (e) => resolve(e.code);
    });
    socket.send(JSON.stringify({ v: 99, type: "subscribe" }));
    expect(await closed).toBe(1008);
  });
  test("recovery catches up with no viewers and transactional settlement is retry safe", async () => {
    for (const selection of ["HOME", "DRAW", "AWAY"])
      await placeBet(sql, second.userId, {
        matchId,
        market: "MATCH_RESULT",
        selection,
        stake: 1,
        requestId: crypto.randomUUID(),
      });
    await sql`UPDATE matches SET scheduled_at=now()-interval '10 minutes',lineup_locks_at=now()-interval '70 minutes' WHERE id=${matchId}`;
    await sql`DELETE FROM jobs WHERE entity_id=${matchId}`;
    await recover(sql);
    await recover(sql);
    await sql.unsafe(
      `CREATE FUNCTION reject_test_payout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='PAYOUT' THEN RAISE EXCEPTION 'Injected payout failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_payout BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION reject_test_payout()`,
    );
    let rolledBack = false;
    for (let i = 0; i < 50; i++) {
      try {
        await runNextJob(sql);
      } catch (error) {
        expect(String(error)).toContain("Injected payout failure");
        rolledBack = true;
        break;
      }
    }
    expect(rolledBack).toBe(true);
    const [unsettled] = await sql`SELECT status FROM matches WHERE id=${matchId}`;
    expect(unsettled.status).toBe("SCHEDULED");
    const [ungraded] =
      await sql`SELECT count(*)::int AS n FROM bets WHERE match_id=${matchId} AND user_id=${second.userId} AND status='PENDING'`;
    expect(ungraded.n).toBe(3);
    expect((await user(sql, second.userId)).coinBalance).toBe(997);
    await sql.unsafe("DROP TRIGGER reject_payout ON ledger; DROP FUNCTION reject_test_payout()");
    await sql`UPDATE jobs SET run_at=now() WHERE entity_id=${matchId} AND done_at IS NULL`;
    for (let i = 0; i < 50; i++) {
      await runNextJob(sql);
      const [m] = await sql`SELECT status FROM matches WHERE id=${matchId}`;
      if (m.status === "RESOLVED") break;
    }
    const snapshot = await matchCenter(sql, matchId);
    expect(snapshot.live?.phase).toBe("FINISHED");
    expect(snapshot.match.status).toBe("RESOLVED");
    expect(snapshot.events.at(-1)?.type).toBe("FULL_TIME");
    const [checkpoint] = await sql<
      { state: SimulationState }[]
    >`SELECT state FROM matches WHERE id=${matchId}`;
    expect(
      await Promise.all([
        sql.begin((tx) => settle(tx, matchId, checkpoint!.state)),
        sql.begin((tx) => settle(tx, matchId, checkpoint!.state)),
      ]),
    ).toEqual([false, false]);
    const before = await ledger(sql, first.userId);
    await recover(sql);
    for (let i = 0; i < 5; i++) await runNextJob(sql);
    expect(await ledger(sql, first.userId)).toEqual(before);
    expect((await standings(sql)).some((s) => s.played > 0)).toBe(true);
    const [pending] =
      await sql`SELECT count(*)::int AS n FROM bets WHERE match_id=${matchId} AND status='PENDING'`;
    expect(pending.n).toBe(0);
    await expect(
      sql`UPDATE bets SET status='PENDING',payout=NULL WHERE match_id=${matchId}`,
    ).rejects.toThrow();
    await expect(
      placeBet(sql, first.userId, {
        matchId,
        market: "MATCH_RESULT",
        selection: "HOME",
        stake: 1,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("closed");
  }, 30000);
  test("worker publishes live updates, resumes stored progress, and resynchronizes after reconnect", async () => {
    const fixture = (await currentRound(sql))!.matches.find(
      (m) => m.status === "SCHEDULED" && m.homeTeam.manager === null && m.awayTeam.manager === null,
    )!;
    await sql`UPDATE matches SET scheduled_at=now()-interval '10 minutes',lineup_locks_at=now()-interval '70 minutes' WHERE id=${fixture.id}`;
    await sql`DELETE FROM jobs WHERE entity_id=${fixture.id}`;
    const socket = new WebSocket(`ws://localhost:${api.server.port}/api/ws`, {
      headers: { Origin: config.WEB_ORIGIN, Cookie: `ffb_session=${first.token}` },
    });
    const update = new Promise<void>((resolve, reject) => {
      socket.onerror = () => reject(new Error("Socket failed"));
      socket.onmessage = (e) => {
        const value = JSON.parse(String(e.data));
        if (value.type === "ready")
          socket.send(
            JSON.stringify({ v: 1, type: "subscribe", matchId: fixture.id, afterRevision: 0 }),
          );
        if (value.type === "changed" && value.revision > 0) resolve();
      };
      setTimeout(() => reject(new Error("Live update timeout")), 5000).unref();
    });
    const worker = startWorker(config);
    await update;
    await worker.close();
    socket.close();
    const partial = await matchCenter(sql, fixture.id);
    expect(partial.match.revision).toBeGreaterThan(0);
    const restarted = startWorker(config);
    try {
      for (let i = 0; i < 100; i++) {
        const latest = await matchCenter(sql, fixture.id);
        if (latest.match.status === "RESOLVED") break;
        await new Promise((r) => setTimeout(r, 30));
      }
      expect((await matchCenter(sql, fixture.id)).match.status).toBe("RESOLVED");
    } finally {
      await restarted.close();
    }
    const reconnected = new WebSocket(`ws://localhost:${api.server.port}/api/ws`, {
      headers: { Origin: config.WEB_ORIGIN, Cookie: `ffb_session=${first.token}` },
    });
    await new Promise<void>((resolve, reject) => {
      reconnected.onerror = () => reject(new Error("Reconnect failed"));
      reconnected.onmessage = (e) => {
        const v = JSON.parse(String(e.data));
        if (v.type === "ready")
          reconnected.send(
            JSON.stringify({ v: 1, type: "subscribe", matchId: fixture.id, afterRevision: 0 }),
          );
        if (v.type === "changed") {
          expect(v.revision).toBeGreaterThanOrEqual(partial.match.revision);
          resolve();
        }
      };
      setTimeout(() => reject(new Error("Resync timeout")), 3000).unref();
    });
    reconnected.close();
  }, 15000);
  test("deactivation revokes access and releases the managed club", async () => {
    const account = await signup(
      sql,
      {
        email: "inactive@example.test",
        username: "inactive_manager",
        displayName: "Inactive",
        password,
      },
      config.WEB_ORIGIN,
    );
    const club = (await teams(sql)).find((t) => !t.manager)!;
    await claimTeam(sql, account.userId, club.id);
    await deactivate(sql, account.userId, password);
    expect(await session(sql, account.token)).toBeNull();
    await expect(claimTeam(sql, account.userId, club.id)).rejects.toThrow("Please sign in");
    expect((await teams(sql)).find((t) => t.id === club.id)?.manager).toBeNull();
    await expect(publicProfile(sql, "inactive_manager")).rejects.toThrow();
  });
  test("mail outbox retries failures and captures safely; worker can restart", async () => {
    await expect(
      deliverMail(sql, {
        async send() {
          throw new Error("temporary");
        },
      }),
    ).rejects.toThrow();
    await sql`UPDATE mail_outbox SET run_at=clock_timestamp() WHERE delivered_at IS NULL`;
    expect(
      await deliverMail(sql, {
        async send(mail) {
          return `test:${mail.id}`;
        },
      }),
    ).toBe(true);
    const worker = startWorker(config);
    await new Promise((r) => setTimeout(r, 200));
    await worker.close();
    const restarted = startWorker(config);
    await new Promise((r) => setTimeout(r, 200));
    await restarted.close();
    const redis = new RedisClient(config.REDIS_URL);
    expect(await redis.send("PING", [])).toBe("PONG");
    redis.close();
  });
});
