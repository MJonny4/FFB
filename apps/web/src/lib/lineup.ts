import type { LineupInput, TeamDetail } from "@ffb/contracts";
import { calculateLineupRatings } from "@ffb/football";

export function inspectLineup(squad: TeamDetail["squad"], lineup: LineupInput) {
  try {
    const ratings = calculateLineupRatings(
      lineup.formation,
      lineup.assignments.map(({ slotKey, playerId }) => {
        const player = squad.find((candidate) => candidate.id === playerId);
        if (!player) throw new Error(`Choose a player for ${slotKey}.`);
        return { slotKey, player };
      }),
    );
    return { ratings, error: "" };
  } catch (error) {
    return {
      ratings: null,
      error: error instanceof Error ? error.message : "Check your starting XI.",
    };
  }
}
