import { expect, test } from "bun:test";
import { playerSchema } from "@ffb/contracts";
import { inspectLineup } from "../apps/web/src/lib/lineup.ts";
import { seedSquads } from "../packages/database/src/seed.ts";

const squad = seedSquads()[0]!;
const source = squad.lineups[0];
const players = squad.players.map((player) => playerSchema.parse(player));
const lineup = {
  formation: source.formation,
  assignments: source.ratings.assignments.map(({ slotKey, player }) => ({
    slotKey,
    playerId: player.id,
  })),
};

test("preparation uses the same position-adjusted ratings as publishing", () => {
  const result = inspectLineup(players, lineup);
  expect(result.error).toBe("");
  expect(result.ratings?.overall).toBe(source.ratings.overall);
  expect(result.ratings?.attack).toBe(source.ratings.attack);
});

test("an empty or unknown assignment cannot produce a ready XI", () => {
  for (const playerId of ["", "missing-player"]) {
    const assignments = lineup.assignments.map((assignment, i) =>
      i === 0 ? { ...assignment, playerId } : assignment,
    );
    const result = inspectLineup(players, { ...lineup, assignments });
    expect(result.ratings).toBeNull();
    expect(result.error).toContain("Choose a player for GK");
  }
});

test("duplicate selections are reported instead of calculating misleading ratings", () => {
  const assignments = lineup.assignments.map((assignment, i) =>
    i === 2 ? { ...assignment, playerId: lineup.assignments[1]!.playerId } : assignment,
  );
  const result = inspectLineup(players, { ...lineup, assignments });
  expect(result.ratings).toBeNull();
  expect(result.error).toContain("more than one lineup slot");
});
