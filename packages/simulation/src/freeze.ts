import {
  calculateLineupRatings,
  type Formation,
  type GeneratedPlayer,
  type SimulationTeam,
  type LineupUnitGroup,
} from "@ffb/football";
export function freezeTeam(
  team: { id: string; name: string },
  formation: Formation,
  assignments: { slotKey: string; playerId: string }[],
  squad: GeneratedPlayer[],
): SimulationTeam {
  const rated = calculateLineupRatings(
    formation,
    assignments.map((a) => {
      const player = squad.find((p) => p.id === a.playerId);
      if (!player) throw new Error("Player does not belong to this club");
      return { slotKey: a.slotKey, player };
    }),
  );
  const unit = (p: GeneratedPlayer): LineupUnitGroup =>
    p.primaryPosition === "GK"
      ? "GK"
      : ["RB", "CB", "LB"].includes(p.primaryPosition)
        ? "DEF"
        : ["ST", "LW", "RW"].includes(p.primaryPosition)
          ? "ATT"
          : "MID";
  const available = squad
    .filter((p) => !assignments.some((a) => a.playerId === p.id))
    .sort((a, b) => b.overall - a.overall || a.id.localeCompare(b.id));
  const bench: GeneratedPlayer[] = [];
  for (const wanted of ["GK", "DEF", "DEF", "MID", "MID", "ATT", "ATT"]) {
    const player =
      available.find((p) => !bench.includes(p) && unit(p) === wanted) ??
      available.find((p) => !bench.includes(p) && p.primaryPosition !== "GK");
    if (!player) throw new Error("Incomplete bench");
    bench.push(player);
  }
  return {
    ...team,
    formation,
    strength: rated.overall,
    players: [
      ...rated.assignments.map((a) => ({
        player: a.player,
        slotKey: a.slotKey,
        unit: a.unit,
        penalty: a.positionPenalty,
      })),
      ...bench.map((player) => ({ player, slotKey: null, unit: unit(player), penalty: 0 })),
    ].map(({ player, slotKey, unit: group, penalty }) => ({
      id: player.id,
      name: `${player.firstName} ${player.lastName}`,
      shirtNumber: player.shirtNumber,
      position: player.primaryPosition,
      secondaryPositions: [...player.secondaryPositions],
      overall: Math.max(1, player.overall - penalty),
      slotKey,
      unit: group,
      attributes: Object.fromEntries(
        Object.entries(player.attributes).map(([k, v]) => [k, Math.max(1, v - penalty)]),
      ),
    })),
  };
}
