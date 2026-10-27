import type { PlayerPosition, RatedPlayer } from "./players.js";

export const FORMATIONS = ["4-3-3", "4-2-3-1", "4-4-2", "3-5-2", "3-4-3", "5-3-2"] as const;

export type Formation = (typeof FORMATIONS)[number];

export const LINEUP_UNIT_GROUPS = ["GK", "DEF", "MID", "ATT"] as const;
export type LineupUnitGroup = (typeof LINEUP_UNIT_GROUPS)[number];

export interface FormationSlot {
  key: string;
  position: PlayerPosition;
  unit: LineupUnitGroup;
}

function slot(key: string, position: PlayerPosition, unit: LineupUnitGroup): FormationSlot {
  return { key, position, unit };
}

export const FORMATION_TEMPLATES = {
  "4-3-3": [
    slot("GK", "GK", "GK"),
    slot("LB", "LB", "DEF"),
    slot("LCB", "CB", "DEF"),
    slot("RCB", "CB", "DEF"),
    slot("RB", "RB", "DEF"),
    slot("LCM", "CM", "MID"),
    slot("CM", "CM", "MID"),
    slot("RCM", "CM", "MID"),
    slot("LW", "LW", "ATT"),
    slot("ST", "ST", "ATT"),
    slot("RW", "RW", "ATT"),
  ],
  "4-2-3-1": [
    slot("GK", "GK", "GK"),
    slot("LB", "LB", "DEF"),
    slot("LCB", "CB", "DEF"),
    slot("RCB", "CB", "DEF"),
    slot("RB", "RB", "DEF"),
    slot("LCDM", "CDM", "MID"),
    slot("RCDM", "CDM", "MID"),
    slot("LM", "LM", "MID"),
    slot("CAM", "CAM", "MID"),
    slot("RM", "RM", "MID"),
    slot("ST", "ST", "ATT"),
  ],
  "4-4-2": [
    slot("GK", "GK", "GK"),
    slot("LB", "LB", "DEF"),
    slot("LCB", "CB", "DEF"),
    slot("RCB", "CB", "DEF"),
    slot("RB", "RB", "DEF"),
    slot("LM", "LM", "MID"),
    slot("LCM", "CM", "MID"),
    slot("RCM", "CM", "MID"),
    slot("RM", "RM", "MID"),
    slot("LST", "ST", "ATT"),
    slot("RST", "ST", "ATT"),
  ],
  "3-5-2": [
    slot("GK", "GK", "GK"),
    slot("LCB", "CB", "DEF"),
    slot("CB", "CB", "DEF"),
    slot("RCB", "CB", "DEF"),
    slot("LM", "LM", "MID"),
    slot("LCM", "CM", "MID"),
    slot("CDM", "CDM", "MID"),
    slot("RCM", "CM", "MID"),
    slot("RM", "RM", "MID"),
    slot("LST", "ST", "ATT"),
    slot("RST", "ST", "ATT"),
  ],
  "3-4-3": [
    slot("GK", "GK", "GK"),
    slot("LCB", "CB", "DEF"),
    slot("CB", "CB", "DEF"),
    slot("RCB", "CB", "DEF"),
    slot("LM", "LM", "MID"),
    slot("LCM", "CM", "MID"),
    slot("RCM", "CM", "MID"),
    slot("RM", "RM", "MID"),
    slot("LW", "LW", "ATT"),
    slot("ST", "ST", "ATT"),
    slot("RW", "RW", "ATT"),
  ],
  "5-3-2": [
    slot("GK", "GK", "GK"),
    slot("LB", "LB", "DEF"),
    slot("LCB", "CB", "DEF"),
    slot("CB", "CB", "DEF"),
    slot("RCB", "CB", "DEF"),
    slot("RB", "RB", "DEF"),
    slot("LCM", "CM", "MID"),
    slot("CM", "CM", "MID"),
    slot("RCM", "CM", "MID"),
    slot("LST", "ST", "ATT"),
    slot("RST", "ST", "ATT"),
  ],
} as const satisfies Record<Formation, readonly FormationSlot[]>;

/**
 * Visual pitch rows are deliberately separate from rating units. A 4-2-3-1,
 * for example, has two midfield lines even though both contribute to MID.
 */
export const FORMATION_PITCH_ROWS = {
  "4-3-3": [["LW", "ST", "RW"], ["LCM", "CM", "RCM"], ["LB", "LCB", "RCB", "RB"], ["GK"]],
  "4-2-3-1": [["ST"], ["LM", "CAM", "RM"], ["LCDM", "RCDM"], ["LB", "LCB", "RCB", "RB"], ["GK"]],
  "4-4-2": [["LST", "RST"], ["LM", "LCM", "RCM", "RM"], ["LB", "LCB", "RCB", "RB"], ["GK"]],
  "3-5-2": [["LST", "RST"], ["LM", "LCM", "CDM", "RCM", "RM"], ["LCB", "CB", "RCB"], ["GK"]],
  "3-4-3": [["LW", "ST", "RW"], ["LM", "LCM", "RCM", "RM"], ["LCB", "CB", "RCB"], ["GK"]],
  "5-3-2": [["LST", "RST"], ["LCM", "CM", "RCM"], ["LB", "LCB", "CB", "RCB", "RB"], ["GK"]],
} as const satisfies Record<Formation, readonly (readonly string[])[]>;

type PositionPenalty = 0 | 1 | 2 | 3 | 4 | 5 | null;

/** Directional cost of moving a player from their natural role to a slot. */
export const POSITION_PENALTIES: Record<PlayerPosition, Record<PlayerPosition, PositionPenalty>> = {
  GK: {
    GK: 0,
    RB: null,
    CB: null,
    LB: null,
    CDM: null,
    CM: null,
    CAM: null,
    RM: null,
    LM: null,
    RW: null,
    LW: null,
    ST: null,
  },
  RB: { GK: null, RB: 0, CB: 1, LB: 3, CDM: 2, CM: 3, CAM: 4, RM: 1, LM: 4, RW: 2, LW: 5, ST: 5 },
  CB: { GK: null, RB: 2, CB: 0, LB: 2, CDM: 1, CM: 3, CAM: 5, RM: 4, LM: 4, RW: 5, LW: 5, ST: 5 },
  LB: { GK: null, RB: 3, CB: 1, LB: 0, CDM: 2, CM: 3, CAM: 4, RM: 4, LM: 1, RW: 5, LW: 2, ST: 5 },
  CDM: { GK: null, RB: 3, CB: 1, LB: 3, CDM: 0, CM: 1, CAM: 3, RM: 3, LM: 3, RW: 4, LW: 4, ST: 5 },
  CM: { GK: null, RB: 4, CB: 3, LB: 4, CDM: 1, CM: 0, CAM: 1, RM: 2, LM: 2, RW: 3, LW: 3, ST: 4 },
  CAM: { GK: null, RB: 5, CB: 5, LB: 5, CDM: 3, CM: 1, CAM: 0, RM: 2, LM: 2, RW: 2, LW: 2, ST: 2 },
  RM: { GK: null, RB: 1, CB: 4, LB: 5, CDM: 3, CM: 2, CAM: 2, RM: 0, LM: 4, RW: 1, LW: 4, ST: 3 },
  LM: { GK: null, RB: 5, CB: 4, LB: 1, CDM: 3, CM: 2, CAM: 2, RM: 4, LM: 0, RW: 4, LW: 1, ST: 3 },
  RW: { GK: null, RB: 3, CB: 5, LB: 5, CDM: 5, CM: 4, CAM: 2, RM: 1, LM: 4, RW: 0, LW: 3, ST: 1 },
  LW: { GK: null, RB: 5, CB: 5, LB: 3, CDM: 5, CM: 4, CAM: 2, RM: 4, LM: 1, RW: 3, LW: 0, ST: 1 },
  ST: { GK: null, RB: 5, CB: 5, LB: 5, CDM: 5, CM: 4, CAM: 2, RM: 3, LM: 3, RW: 1, LW: 1, ST: 0 },
};

export interface LineupAssignment<TPlayer extends RatedPlayer = RatedPlayer> {
  slotKey: string;
  player: TPlayer;
}

export interface RatedLineupAssignment<
  TPlayer extends RatedPlayer = RatedPlayer,
> extends LineupAssignment<TPlayer> {
  slotPosition: PlayerPosition;
  unit: LineupUnitGroup;
  positionPenalty: number;
  adjustedRating: number;
}

export interface LineupRatings<TPlayer extends RatedPlayer = RatedPlayer> {
  formation: Formation;
  overall: number;
  attack: number;
  midfield: number;
  defense: number;
  goalkeeper: number;
  assignments: RatedLineupAssignment<TPlayer>[];
}

export function isFormation(value: string): value is Formation {
  return (FORMATIONS as readonly string[]).includes(value);
}

export function getPositionPenalty(
  player: Pick<RatedPlayer, "primaryPosition" | "secondaryPositions">,
  slotPosition: PlayerPosition,
): number | null {
  const naturalPositions = [player.primaryPosition, ...player.secondaryPositions];
  let bestPenalty: number | null = null;

  for (const position of naturalPositions) {
    const penalty = POSITION_PENALTIES[position][slotPosition];
    if (penalty !== null && (bestPenalty === null || penalty < bestPenalty)) {
      bestPenalty = penalty;
    }
  }

  return bestPenalty;
}

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function average(values: readonly number[], label: string): number {
  if (values.length === 0) {
    throw new Error(`${label} has no assigned players`);
  }
  return roundToTwo(values.reduce((total, value) => total + value, 0) / values.length);
}

export function calculateLineupRatings<TPlayer extends RatedPlayer>(
  formation: Formation,
  assignments: readonly LineupAssignment<TPlayer>[],
): LineupRatings<TPlayer> {
  const template = FORMATION_TEMPLATES[formation];
  if (assignments.length !== template.length) {
    throw new Error(`${formation} requires exactly ${template.length} assignments`);
  }

  const assignmentsBySlot = new Map(
    assignments.map((assignment) => [assignment.slotKey, assignment]),
  );
  if (assignmentsBySlot.size !== assignments.length) {
    throw new Error("Every lineup slot must be assigned exactly once");
  }
  if (new Set(assignments.map(({ player }) => player.id)).size !== assignments.length) {
    throw new Error("A player cannot occupy more than one lineup slot");
  }

  const ratedAssignments = template.map((templateSlot) => {
    const assignment = assignmentsBySlot.get(templateSlot.key);
    if (!assignment) {
      throw new Error(`Missing assignment for ${templateSlot.key}`);
    }
    if (
      !Number.isFinite(assignment.player.overall) ||
      assignment.player.overall < 1 ||
      assignment.player.overall > 99
    ) {
      throw new RangeError("Player overall must be between 1 and 99");
    }

    const positionPenalty = getPositionPenalty(assignment.player, templateSlot.position);
    if (positionPenalty === null) {
      throw new Error(`${assignment.player.primaryPosition} cannot play ${templateSlot.position}`);
    }

    return {
      ...assignment,
      slotPosition: templateSlot.position,
      unit: templateSlot.unit,
      positionPenalty,
      adjustedRating: Math.max(1, assignment.player.overall - positionPenalty),
    };
  });

  const forUnit = (unit: LineupUnitGroup): number[] =>
    ratedAssignments
      .filter((assignment) => assignment.unit === unit)
      .map((assignment) => assignment.adjustedRating);

  return {
    formation,
    overall: average(
      ratedAssignments.map(({ adjustedRating }) => adjustedRating),
      "Lineup",
    ),
    attack: average(forUnit("ATT"), "Attack"),
    midfield: average(forUnit("MID"), "Midfield"),
    defense: average(forUnit("DEF"), "Defense"),
    goalkeeper: average(forUnit("GK"), "Goalkeeper"),
    assignments: ratedAssignments,
  };
}

/**
 * Solves the rectangular assignment problem so every formation receives the
 * strongest compatible XI, rather than relying on slot-order-dependent greed.
 */
export function selectBestLineup<TPlayer extends RatedPlayer>(
  formation: Formation,
  players: readonly TPlayer[],
): LineupRatings<TPlayer> {
  const slots = FORMATION_TEMPLATES[formation];
  if (players.length < slots.length) {
    throw new Error(`At least ${slots.length} players are required`);
  }
  if (new Set(players.map(({ id }) => id)).size !== players.length) {
    throw new Error("Every candidate player id must be unique");
  }

  const sortedPlayers = [...players].sort((left, right) => left.id.localeCompare(right.id));
  const invalidCost = 10_000;
  const costs = slots.map((formationSlot) =>
    sortedPlayers.map((player) => {
      const penalty = getPositionPenalty(player, formationSlot.position);
      return penalty === null ? invalidCost : 99 - (player.overall - penalty);
    }),
  );

  const rowCount = slots.length;
  const columnCount = sortedPlayers.length;
  const rowPotential = Array.from({ length: rowCount + 1 }, () => 0);
  const columnPotential = Array.from({ length: columnCount + 1 }, () => 0);
  const matchedRow = Array.from({ length: columnCount + 1 }, () => 0);
  const previousColumn = Array.from({ length: columnCount + 1 }, () => 0);

  for (let row = 1; row <= rowCount; row += 1) {
    matchedRow[0] = row;
    let currentColumn = 0;
    const minimum = Array.from({ length: columnCount + 1 }, () => Infinity);
    const used = Array.from({ length: columnCount + 1 }, () => false);

    do {
      used[currentColumn] = true;
      const currentRow = matchedRow[currentColumn];
      if (currentRow === undefined) throw new Error("Lineup matching failed");
      let delta = Infinity;
      let nextColumn = 0;

      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const cost = costs[currentRow - 1]?.[column - 1];
        if (cost === undefined) throw new Error("Lineup cost matrix is incomplete");
        const currentRowPotential = rowPotential[currentRow];
        const currentColumnPotential = columnPotential[column];
        const currentMinimum = minimum[column];
        if (
          currentRowPotential === undefined ||
          currentColumnPotential === undefined ||
          currentMinimum === undefined
        ) {
          throw new Error("Lineup matching failed");
        }
        const candidate = cost - currentRowPotential - currentColumnPotential;
        if (candidate < currentMinimum) {
          minimum[column] = candidate;
          previousColumn[column] = currentColumn;
        }
        const updatedMinimum = minimum[column];
        if (updatedMinimum !== undefined && updatedMinimum < delta) {
          delta = updatedMinimum;
          nextColumn = column;
        }
      }

      if (!Number.isFinite(delta)) {
        throw new Error(`No complete compatible XI exists for ${formation}`);
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          const usedRow = matchedRow[column];
          if (usedRow === undefined) throw new Error("Lineup matching failed");
          const usedRowPotential = rowPotential[usedRow];
          const usedColumnPotential = columnPotential[column];
          if (usedRowPotential === undefined || usedColumnPotential === undefined) {
            throw new Error("Lineup matching failed");
          }
          rowPotential[usedRow] = usedRowPotential + delta;
          columnPotential[column] = usedColumnPotential - delta;
        } else {
          const currentMinimum = minimum[column];
          if (currentMinimum === undefined) {
            throw new Error("Lineup matching failed");
          }
          minimum[column] = currentMinimum - delta;
        }
      }
      currentColumn = nextColumn;
    } while (matchedRow[currentColumn] !== 0);

    do {
      const priorColumn = previousColumn[currentColumn];
      if (priorColumn === undefined) throw new Error("Lineup matching failed");
      matchedRow[currentColumn] = matchedRow[priorColumn] ?? 0;
      currentColumn = priorColumn;
    } while (currentColumn !== 0);
  }

  const playerIndexBySlot = Array.from({ length: rowCount }, () => -1);
  for (let column = 1; column <= columnCount; column += 1) {
    const row = matchedRow[column];
    if (row !== undefined && row > 0) playerIndexBySlot[row - 1] = column - 1;
  }

  const assignments = slots.map((formationSlot, slotIndex) => {
    const playerIndex = playerIndexBySlot[slotIndex];
    if (playerIndex === undefined) {
      throw new Error(`No complete compatible XI exists for ${formation}`);
    }
    const player = sortedPlayers[playerIndex];
    if (!player || costs[slotIndex]?.[playerIndex] === invalidCost) {
      throw new Error(`No complete compatible XI exists for ${formation}`);
    }
    return { slotKey: formationSlot.key, player };
  });

  return calculateLineupRatings(formation, assignments);
}
