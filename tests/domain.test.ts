import { describe, test, expect } from "bun:test";
import {
  getMarketProbabilities,
  createOddsQuotes,
  probabilityToDecimalOdds,
  gradeBet,
  calculatePayout,
  calculateStandings,
  selectBestLineup,
  calculateLineupRatings,
  FORMATIONS,
  getRoundSchedule,
  roundCalendar,
  madridTime,
} from "@ffb/football";
import { seedSquads } from "../packages/database/src/seed.ts";
import {
  freezeTeam,
  initializeSimulation,
  stepSimulation,
  simulationResult,
} from "@ffb/simulation";
import { betInput, lineupInput, clientMessage, serverMessage } from "@ffb/contracts";
import { loadConfig } from "@ffb/config";
const legacyResult = await Bun.file(
  new URL("./fixtures/legacy-result.json", import.meta.url),
).json();
const squads = seedSquads();
function fixture() {
  const team = (index: number) => {
    const squad = squads[index]!;
    const l = squad.lineups[0];
    return freezeTeam(
      { id: squad.teamKey, name: squad.teamKey },
      l.formation,
      l.ratings.assignments.map((a) => ({ slotKey: a.slotKey, playerId: a.player.id })),
      squad.players,
    );
  };
  return {
    version: "touchline-v1" as const,
    matchId: "characterization",
    home: team(0),
    away: team(1),
  };
}
describe("odds and grading", () => {
  test("probabilities form normalized mutually exclusive markets", () => {
    for (const ratings of [
      [1, 100],
      [50, 50],
      [100, 1],
    ]) {
      const p = getMarketProbabilities(ratings[0]!, ratings[1]!);
      for (const values of Object.values(p))
        expect(
          Object.values(values)
            .map(Number)
            .reduce((a, b) => a + b, 0),
        ).toBeCloseTo(1, 8);
      expect(createOddsQuotes(ratings[0]!, ratings[1]!)).toHaveLength(24);
    }
  });
  test("invalid probabilities, ratings and selections fail", () => {
    for (const p of [0, -1, NaN, 1.1]) expect(() => probabilityToDecimalOdds(p)).toThrow();
    expect(() => getMarketProbabilities(0, 80)).toThrow();
    expect(() =>
      gradeBet("MATCH_RESULT", "OTHER", {
        homeScore: 0,
        awayScore: 0,
        homeCards: 0,
        awayCards: 0,
        homeCorners: 0,
        awayCorners: 0,
      }),
    ).toThrow();
  });
  test("score overflow and half-line markets grade correctly", () => {
    const r = {
      homeScore: 4,
      awayScore: 0,
      homeCards: 2,
      awayCards: 2,
      homeCorners: 5,
      awayCorners: 5,
    };
    expect(gradeBet("EXACT_SCORE", "OTHER", r)).toBe(true);
    expect(gradeBet("TOTAL_CARDS", "UNDER", r)).toBe(true);
    expect(gradeBet("TOTAL_CORNERS", "OVER", r)).toBe(true);
    expect(gradeBet("TOTAL_CARDS", "OVER", { ...r, awayCards: 3 })).toBe(true);
    expect(() => gradeBet("EXACT_SCORE", "OTHER", { ...r, homeScore: -1 })).toThrow();
  });
  test("payout uses exact decimal flooring", () => {
    expect(calculatePayout(100, "1.1300")).toBe(113);
    expect(calculatePayout(1, "1.9999")).toBe(1);
    expect(calculatePayout(1000000, "99999.9999")).toBe(99999999900);
    expect(() => calculatePayout(1, "1.00001")).toThrow();
    expect(() => calculatePayout(0, "2")).toThrow();
  });
});
describe("squads, lineups and table", () => {
  test("20 stable squads have unique players and three viable lineups", () => {
    expect(squads).toHaveLength(20);
    expect(new Set(squads.flatMap((s) => s.players.map((p) => p.id))).size).toBe(460);
    expect(seedSquads()).toEqual(squads);
    for (const s of squads) {
      expect(s.players).toHaveLength(23);
      for (const f of FORMATIONS)
        expect(selectBestLineup(f, s.players).assignments).toHaveLength(11);
    }
  });
  test("duplicates, keeper mismatch and missing slots fail", () => {
    const best = selectBestLineup("4-3-3", squads[0]!.players);
    expect(() => calculateLineupRatings("4-3-3", best.assignments.slice(1))).toThrow();
    const duplicate = best.assignments.map((a) => ({ ...a }));
    duplicate[1]!.player = duplicate[0]!.player;
    expect(() => calculateLineupRatings("4-3-3", duplicate)).toThrow();
  });
  test("standings include idle clubs and deterministic tiebreaks", () => {
    const teams = [
      { id: "b", name: "Beta", crestImageUrl: null },
      { id: "a", name: "Alpha", crestImageUrl: null },
      { id: "c", name: "Idle", crestImageUrl: null },
    ];
    const table = calculateStandings(teams, [
      {
        id: "m",
        weekNumber: 1,
        scheduledAt: "2026-01-01T12:00:00Z",
        resolvedAt: "2026-01-01T13:00:00Z",
        homeTeamId: "b",
        awayTeamId: "a",
        resultPayload: { homeScore: 1, awayScore: 1 },
      },
    ]);
    expect(table.entries.map((e) => e.team.id)).toEqual(["a", "b", "c"]);
    expect(table.entries[0]!.points).toBe(1);
  });
});
describe("Madrid calendar and lifecycle", () => {
  test("round-robin covers each pair once and reverses next cycle", () => {
    const teams = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
    const pairs = new Set<string>();
    for (let week = 1; week <= 19; week++) {
      const games = getRoundSchedule(teams, week, { random: () => 0.5 });
      expect(new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId])).size).toBe(20);
      expect(games.filter((g) => g.scheduledDay === "SAT")).toHaveLength(5);
      for (const g of games) pairs.add([g.homeTeamId, g.awayTeamId].sort().join(":"));
    }
    expect(pairs.size).toBe(190);
    const first = getRoundSchedule(teams, 1, { random: () => 0.5 })[0]!,
      reverse = getRoundSchedule(teams, 20, { random: () => 0.5 })[0]!;
    expect(first.homeTeamId).toBe(reverse.awayTeamId);
  });
  test("spring and autumn DST retain local Sunday kickoff", () => {
    const spring = roundCalendar(new Date("2026-03-23T12:00:00Z")),
      fall = roundCalendar(new Date("2026-10-19T12:00:00Z"));
    expect(spring.kickoff("SUN", 13 * 60).toISOString()).toBe("2026-03-29T11:00:00.000Z");
    expect(fall.kickoff("SUN", 13 * 60).toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(+spring.nextOpen - +spring.opensAt).toBe(167 * 3600000);
    expect(+fall.nextOpen - +fall.opensAt).toBe(169 * 3600000);
  });
  test("Monday open and Friday close are precise Madrid instants", () => {
    const c = roundCalendar(new Date("2026-10-27T12:00:00Z"));
    expect(c.opensAt.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(c.closesAt.toISOString()).toBe("2026-10-30T22:59:00.000Z");
    expect(madridTime(2026, 10, 27, 13).toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });
});
describe("seeded engine", () => {
  test("checkpoint JSON roundtrip and restart produce the exact same game", () => {
    const input = fixture();
    let a = initializeSimulation(input, "legacy-seed"),
      b = initializeSimulation(input, "legacy-seed");
    const events = [];
    for (let i = 0; i < 1800 && a.phase !== "FINISHED"; i++) {
      const next = stepSimulation(input, a);
      a = next.state;
      events.push(...next.events);
      b = stepSimulation(input, JSON.parse(JSON.stringify(b))).state;
    }
    expect(a.phase).toBe("FINISHED");
    expect(b).toEqual(a);
    expect(simulationResult(b)).toEqual(simulationResult(a));
    expect(events.map((e) => e.sequence)).toEqual(
      Array.from({ length: events.length }, (_, i) => i + 1),
    );
    expect(events.at(-1)?.type).toBe("FULL_TIME");
    expect(simulationResult(a)).toEqual(legacyResult);
  });
  test("cannot grade before full time and different seeds diverge", () => {
    const input = fixture(),
      a = initializeSimulation(input, "a"),
      b = initializeSimulation(input, "b");
    expect(() => simulationResult(a)).toThrow();
    expect(stepSimulation(input, a).state.randomState).not.toBe(
      stepSimulation(input, b).state.randomState,
    );
  });
});
describe("contracts and config", () => {
  test("transport rejects invalid markets and unversioned socket messages", () => {
    expect(
      betInput.safeParse({
        matchId: "x",
        market: "MATCH_RESULT",
        selection: "OVER",
        stake: 1,
        requestId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(lineupInput.safeParse({ formation: "9-1", assignments: [] }).success).toBe(false);
    expect(clientMessage.safeParse({ type: "subscribe", matchId: "x" }).success).toBe(false);
    expect(
      clientMessage.safeParse({ v: 1, type: "subscribe", matchId: "../private", afterRevision: 0 })
        .success,
    ).toBe(false);
    expect(serverMessage.parse({ v: 1, type: "ready" })).toEqual({ v: 1, type: "ready" });
  });
  test("production settings fail closed", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://localhost/ffb",
        REDIS_URL: "redis://localhost:6379",
        WEB_ORIGIN: "http://localhost:5173",
      }),
    ).toThrow();
  });
});
