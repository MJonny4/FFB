export const PLAYER_POSITIONS = [
  "GK",
  "RB",
  "CB",
  "LB",
  "CDM",
  "CM",
  "CAM",
  "RM",
  "LM",
  "RW",
  "LW",
  "ST",
] as const;

export type PlayerPosition = (typeof PLAYER_POSITIONS)[number];
export type OutfieldPosition = Exclude<PlayerPosition, "GK">;

export const OUTFIELD_ATTRIBUTE_KEYS = [
  "pace",
  "shooting",
  "passing",
  "dribbling",
  "defending",
  "physical",
] as const;

export type OutfieldAttribute = (typeof OUTFIELD_ATTRIBUTE_KEYS)[number];

export const GOALKEEPER_ATTRIBUTE_KEYS = [
  "diving",
  "handling",
  "kicking",
  "reflexes",
  "speed",
  "positioning",
] as const;

export type GoalkeeperAttribute = (typeof GOALKEEPER_ATTRIBUTE_KEYS)[number];

export type OutfieldAttributes = Record<OutfieldAttribute, number>;
export type GoalkeeperAttributes = Record<GoalkeeperAttribute, number>;

export interface RatedPlayer {
  id: string;
  primaryPosition: PlayerPosition;
  secondaryPositions: readonly PlayerPosition[];
  overall: number;
}

const OUTFIELD_OVERALL_WEIGHTS = {
  RB: {
    pace: 0.2,
    shooting: 0.05,
    passing: 0.18,
    dribbling: 0.16,
    defending: 0.26,
    physical: 0.15,
  },
  CB: {
    pace: 0.1,
    shooting: 0.02,
    passing: 0.1,
    dribbling: 0.07,
    defending: 0.43,
    physical: 0.28,
  },
  LB: {
    pace: 0.2,
    shooting: 0.05,
    passing: 0.18,
    dribbling: 0.16,
    defending: 0.26,
    physical: 0.15,
  },
  CDM: {
    pace: 0.12,
    shooting: 0.07,
    passing: 0.22,
    dribbling: 0.15,
    defending: 0.28,
    physical: 0.16,
  },
  CM: {
    pace: 0.13,
    shooting: 0.12,
    passing: 0.28,
    dribbling: 0.22,
    defending: 0.12,
    physical: 0.13,
  },
  CAM: {
    pace: 0.16,
    shooting: 0.22,
    passing: 0.23,
    dribbling: 0.25,
    defending: 0.05,
    physical: 0.09,
  },
  RM: {
    pace: 0.22,
    shooting: 0.17,
    passing: 0.22,
    dribbling: 0.25,
    defending: 0.06,
    physical: 0.08,
  },
  LM: {
    pace: 0.22,
    shooting: 0.17,
    passing: 0.22,
    dribbling: 0.25,
    defending: 0.06,
    physical: 0.08,
  },
  RW: {
    pace: 0.27,
    shooting: 0.22,
    passing: 0.18,
    dribbling: 0.25,
    defending: 0.03,
    physical: 0.05,
  },
  LW: {
    pace: 0.27,
    shooting: 0.22,
    passing: 0.18,
    dribbling: 0.25,
    defending: 0.03,
    physical: 0.05,
  },
  ST: {
    pace: 0.2,
    shooting: 0.36,
    passing: 0.11,
    dribbling: 0.2,
    defending: 0.03,
    physical: 0.1,
  },
} as const satisfies Record<OutfieldPosition, Record<OutfieldAttribute, number>>;

const GOALKEEPER_OVERALL_WEIGHTS = {
  diving: 0.21,
  handling: 0.2,
  kicking: 0.12,
  reflexes: 0.25,
  speed: 0.07,
  positioning: 0.15,
} as const satisfies Record<GoalkeeperAttribute, number>;

function assertAttribute(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 99) {
    throw new RangeError(`${label} must be a whole number between 1 and 99`);
  }
}

function weightedOverall<TAttribute extends string>(
  attributes: Record<TAttribute, number>,
  weights: Record<TAttribute, number>,
): number {
  let total = 0;
  for (const key of Object.keys(weights) as TAttribute[]) {
    const value = attributes[key];
    assertAttribute(value, key);
    total += value * weights[key];
  }
  return Math.round(total);
}

export function calculateOutfieldOverall(
  position: OutfieldPosition,
  attributes: OutfieldAttributes,
): number {
  return weightedOverall(attributes, OUTFIELD_OVERALL_WEIGHTS[position]);
}

export function calculateGoalkeeperOverall(attributes: GoalkeeperAttributes): number {
  return weightedOverall(attributes, GOALKEEPER_OVERALL_WEIGHTS);
}
