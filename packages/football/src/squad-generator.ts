import { FORMATIONS, selectBestLineup, type Formation, type LineupRatings } from "./formations.js";
import {
  GOALKEEPER_ATTRIBUTE_KEYS,
  OUTFIELD_ATTRIBUTE_KEYS,
  calculateGoalkeeperOverall,
  calculateOutfieldOverall,
  type GoalkeeperAttributes,
  type OutfieldAttributes,
  type OutfieldPosition,
  type PlayerPosition,
} from "./players.js";

export const SQUAD_GENERATION_VERSION = "squads-v1";
export const PLAYERS_PER_SQUAD = 23;

export const EUROPEAN_NATIONALITY_WEIGHTS = [
  { code: "ES", weight: 12 },
  { code: "FR", weight: 12 },
  { code: "PT", weight: 8 },
  { code: "GB", weight: 10 },
  { code: "DE", weight: 10 },
  { code: "IT", weight: 10 },
  { code: "NL", weight: 7 },
  { code: "BE", weight: 5 },
  { code: "HR", weight: 4 },
  { code: "RS", weight: 4 },
  { code: "PL", weight: 5 },
  { code: "DK", weight: 3 },
  { code: "SE", weight: 3 },
  { code: "NO", weight: 2 },
  { code: "CH", weight: 3 },
  { code: "AT", weight: 3 },
  { code: "CZ", weight: 3 },
  { code: "SK", weight: 2 },
  { code: "SI", weight: 2 },
  { code: "RO", weight: 3 },
  { code: "BG", weight: 2 },
  { code: "GR", weight: 2 },
  { code: "IE", weight: 2 },
  { code: "IS", weight: 1 },
  { code: "FI", weight: 2 },
  { code: "UA", weight: 3 },
  { code: "HU", weight: 3 },
  { code: "AL", weight: 2 },
  { code: "BA", weight: 2 },
  { code: "ME", weight: 1 },
  { code: "MK", weight: 1 },
  { code: "CY", weight: 1 },
] as const;

export type EuropeanNationalityCode = (typeof EUROPEAN_NATIONALITY_WEIGHTS)[number]["code"];

/** Three keepers, eight defenders, eight midfield/wide players, four forwards. */
export const SQUAD_POSITION_PLAN = [
  "GK",
  "GK",
  "GK",
  "RB",
  "RB",
  "CB",
  "CB",
  "CB",
  "CB",
  "LB",
  "LB",
  "CDM",
  "CM",
  "CM",
  "CAM",
  "RM",
  "LM",
  "RW",
  "LW",
  "ST",
  "ST",
  "ST",
  "ST",
] as const satisfies readonly PlayerPosition[];

export interface PlayerIdentity {
  firstName: string;
  lastName: string;
}

export interface SquadGenerationTeam {
  /** An immutable database identity, not a display name. */
  key: string;
  targetStrength: number;
}

interface GeneratedPlayerBase {
  id: string;
  generationKey: string;
  firstName: string;
  lastName: string;
  nationalityCode: EuropeanNationalityCode;
  shirtNumber: number;
  overall: number;
}

export interface GeneratedGoalkeeper extends GeneratedPlayerBase {
  kind: "GOALKEEPER";
  primaryPosition: "GK";
  secondaryPositions: readonly [];
  attributes: GoalkeeperAttributes;
}

export interface GeneratedOutfieldPlayer extends GeneratedPlayerBase {
  kind: "OUTFIELD";
  primaryPosition: OutfieldPosition;
  secondaryPositions: readonly OutfieldPosition[];
  attributes: OutfieldAttributes;
}

export type GeneratedPlayer = GeneratedGoalkeeper | GeneratedOutfieldPlayer;

export interface GeneratedSystemLineup {
  label: string;
  formation: Formation;
  official: boolean;
  ratings: LineupRatings<GeneratedPlayer>;
}

export interface GeneratedTeamSquad {
  teamKey: string;
  targetStrength: number;
  strengthRating: number;
  players: GeneratedPlayer[];
  lineups: [GeneratedSystemLineup, GeneratedSystemLineup, GeneratedSystemLineup];
}

type RandomSource = () => number;

const SECONDARY_POSITION_OPTIONS: Record<OutfieldPosition, readonly OutfieldPosition[]> = {
  RB: ["RM", "CB", "LB"],
  CB: ["CDM", "RB", "LB"],
  LB: ["LM", "CB", "RB"],
  CDM: ["CM", "CB", "CAM"],
  CM: ["CDM", "CAM", "RM", "LM"],
  CAM: ["CM", "RW", "LW", "ST"],
  RM: ["RW", "RB", "CM", "CAM"],
  LM: ["LW", "LB", "CM", "CAM"],
  RW: ["RM", "ST", "LW", "CAM"],
  LW: ["LM", "ST", "RW", "CAM"],
  ST: ["RW", "LW", "CAM"],
};

const OUTFIELD_ATTRIBUTE_SHAPES: Record<OutfieldPosition, OutfieldAttributes> = {
  RB: { pace: 5, shooting: -8, passing: 1, dribbling: 2, defending: 5, physical: 2 },
  CB: { pace: -3, shooting: -15, passing: -3, dribbling: -6, defending: 10, physical: 8 },
  LB: { pace: 5, shooting: -8, passing: 1, dribbling: 2, defending: 5, physical: 2 },
  CDM: { pace: -2, shooting: -7, passing: 4, dribbling: 0, defending: 8, physical: 6 },
  CM: { pace: 0, shooting: -1, passing: 7, dribbling: 5, defending: 0, physical: 1 },
  CAM: { pace: 3, shooting: 5, passing: 6, dribbling: 8, defending: -13, physical: -4 },
  RM: { pace: 7, shooting: 1, passing: 4, dribbling: 7, defending: -10, physical: -3 },
  LM: { pace: 7, shooting: 1, passing: 4, dribbling: 7, defending: -10, physical: -3 },
  RW: { pace: 10, shooting: 5, passing: 1, dribbling: 9, defending: -16, physical: -5 },
  LW: { pace: 10, shooting: 5, passing: 1, dribbling: 9, defending: -16, physical: -5 },
  ST: { pace: 4, shooting: 11, passing: -4, dribbling: 3, defending: -18, physical: 5 },
};

const GOALKEEPER_ATTRIBUTE_SHAPE: GoalkeeperAttributes = {
  diving: 3,
  handling: 1,
  kicking: -2,
  reflexes: 5,
  speed: -13,
  positioning: 3,
};

const PREFERRED_SHIRT_NUMBERS: Record<PlayerPosition, readonly number[]> = {
  GK: [1, 13, 23, 25, 30],
  RB: [2, 12, 22, 24],
  CB: [4, 5, 14, 15, 16, 26],
  LB: [3, 17, 21, 27],
  CDM: [6, 14, 18, 24],
  CM: [8, 16, 18, 20],
  CAM: [10, 18, 20, 24],
  RM: [7, 12, 17, 22],
  LM: [11, 15, 19, 21],
  RW: [7, 11, 17, 19],
  LW: [7, 11, 17, 19],
  ST: [9, 10, 18, 19, 21],
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createSeededRandom(seed: string): RandomSource {
  let state = hashSeed(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(values: readonly T[], random: RandomSource): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const current = result[index];
    const replacement = result[target];
    if (current === undefined || replacement === undefined) {
      throw new Error("Invalid deterministic shuffle index");
    }
    result[index] = replacement;
    result[target] = current;
  }
  return result;
}

function randomWhole(minimum: number, maximum: number, random: RandomSource): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

function pickNationality(random: RandomSource): EuropeanNationalityCode {
  const totalWeight = EUROPEAN_NATIONALITY_WEIGHTS.reduce(
    (total, entry) => total + entry.weight,
    0,
  );
  let selection = random() * totalWeight;
  for (const entry of EUROPEAN_NATIONALITY_WEIGHTS) {
    selection -= entry.weight;
    if (selection < 0) return entry.code;
  }
  return EUROPEAN_NATIONALITY_WEIGHTS.at(-1)?.code ?? "ES";
}

function pickSecondaryPositions(
  primaryPosition: OutfieldPosition,
  random: RandomSource,
): OutfieldPosition[] {
  const roll = random();
  const count = roll < 0.25 ? 0 : roll < 0.8 ? 1 : 2;
  return shuffle(SECONDARY_POSITION_OPTIONS[primaryPosition], random).slice(0, count);
}

function normalizedIdentityKey(identity: PlayerIdentity): string {
  return `${identity.firstName.trim().toLocaleLowerCase("en-US")}\u0000${identity.lastName.trim().toLocaleLowerCase("en-US")}`;
}

function validateIdentities(
  identities: readonly PlayerIdentity[],
  requiredCount: number,
): PlayerIdentity[] {
  const cleaned = identities.map((identity) => ({
    firstName: identity.firstName.trim(),
    lastName: identity.lastName.trim(),
  }));
  for (const identity of cleaned) {
    if (!identity.firstName || !identity.lastName) {
      throw new Error("Every player identity requires a first and last name");
    }
  }
  if (new Set(cleaned.map(normalizedIdentityKey)).size !== cleaned.length) {
    throw new Error("Player identities must be unique");
  }
  if (cleaned.length < requiredCount) {
    throw new Error(`${requiredCount} unique identities are required; received ${cleaned.length}`);
  }
  return cleaned;
}

function addNoise(base: number, random: RandomSource): number {
  return clamp(base + randomWhole(-4, 4, random), 1, 99);
}

function normalizeOutfieldAttributes(
  position: OutfieldPosition,
  attributes: OutfieldAttributes,
  desiredOverall: number,
): OutfieldAttributes {
  let result = { ...attributes };
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = desiredOverall - calculateOutfieldOverall(position, result);
    if (offset === 0) break;
    result = Object.fromEntries(
      OUTFIELD_ATTRIBUTE_KEYS.map((key) => [key, clamp(result[key] + offset, 1, 99)]),
    ) as unknown as OutfieldAttributes;
  }
  return result;
}

function normalizeGoalkeeperAttributes(
  attributes: GoalkeeperAttributes,
  desiredOverall: number,
): GoalkeeperAttributes {
  let result = { ...attributes };
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = desiredOverall - calculateGoalkeeperOverall(result);
    if (offset === 0) break;
    result = Object.fromEntries(
      GOALKEEPER_ATTRIBUTE_KEYS.map((key) => [key, clamp(result[key] + offset, 1, 99)]),
    ) as unknown as GoalkeeperAttributes;
  }
  return result;
}

function createOutfieldAttributes(
  position: OutfieldPosition,
  desiredOverall: number,
  random: RandomSource,
): OutfieldAttributes {
  const shape = OUTFIELD_ATTRIBUTE_SHAPES[position];
  const attributes = Object.fromEntries(
    OUTFIELD_ATTRIBUTE_KEYS.map((key) => [key, addNoise(desiredOverall + shape[key], random)]),
  ) as unknown as OutfieldAttributes;
  return normalizeOutfieldAttributes(position, attributes, desiredOverall);
}

function createGoalkeeperAttributes(
  desiredOverall: number,
  random: RandomSource,
): GoalkeeperAttributes {
  const attributes = Object.fromEntries(
    GOALKEEPER_ATTRIBUTE_KEYS.map((key) => [
      key,
      addNoise(desiredOverall + GOALKEEPER_ATTRIBUTE_SHAPE[key], random),
    ]),
  ) as unknown as GoalkeeperAttributes;
  return normalizeGoalkeeperAttributes(attributes, desiredOverall);
}

function chooseShirtNumber(
  position: PlayerPosition,
  usedNumbers: Set<number>,
  random: RandomSource,
): number {
  const preferred = shuffle(PREFERRED_SHIRT_NUMBERS[position], random).find(
    (number) => !usedNumbers.has(number),
  );
  if (preferred !== undefined) {
    usedNumbers.add(preferred);
    return preferred;
  }

  const available = Array.from({ length: 99 }, (_, index) => index + 1).filter(
    (number) => !usedNumbers.has(number),
  );
  const selected = available[Math.floor(random() * available.length)];
  if (selected === undefined) throw new Error("No shirt number is available");
  usedNumbers.add(selected);
  return selected;
}

function shiftPlayerOverall(player: GeneratedPlayer, offset: number): GeneratedPlayer {
  if (offset === 0) return player;
  const desiredOverall = clamp(player.overall + offset, 1, 92);
  if (player.kind === "GOALKEEPER") {
    const attributes = normalizeGoalkeeperAttributes(player.attributes, desiredOverall);
    return {
      ...player,
      attributes,
      overall: calculateGoalkeeperOverall(attributes),
    };
  }

  const attributes = normalizeOutfieldAttributes(
    player.primaryPosition,
    player.attributes,
    desiredOverall,
  );
  return {
    ...player,
    attributes,
    overall: calculateOutfieldOverall(player.primaryPosition, attributes),
  };
}

function generateTeamPlayers(
  team: SquadGenerationTeam,
  identities: readonly PlayerIdentity[],
  generationVersion: string,
  exceptionalPlayerIndex: number | null,
): { players: GeneratedPlayer[]; exceptionalPlayerId: string | null } {
  const random = createSeededRandom(`${generationVersion}:${team.key}`);
  const usedNumbers = new Set<number>();

  const players = SQUAD_POSITION_PLAN.map((primaryPosition, index) => {
    const identity = identities[index];
    if (!identity) throw new Error(`Identity ${index} is unavailable`);
    const generationKey = `${generationVersion}:${team.key}:player:${index + 1}`;
    const exceptional = index === exceptionalPlayerIndex;
    const normalTarget = Math.round(
      clamp(team.targetStrength - 2 + (random() + random() - 1) * 6, 45, 88),
    );
    const desiredOverall = exceptional
      ? Math.round(clamp(Math.max(team.targetStrength + 8, 84 + random() * 9), 84, 92))
      : normalTarget;
    const base = {
      id: generationKey,
      generationKey,
      firstName: identity.firstName,
      lastName: identity.lastName,
      nationalityCode: pickNationality(random),
      shirtNumber: chooseShirtNumber(primaryPosition, usedNumbers, random),
    };

    if (primaryPosition === "GK") {
      const attributes = createGoalkeeperAttributes(desiredOverall, random);
      return {
        ...base,
        kind: "GOALKEEPER" as const,
        primaryPosition,
        secondaryPositions: [] as const,
        attributes,
        overall: calculateGoalkeeperOverall(attributes),
      };
    }

    const attributes = createOutfieldAttributes(primaryPosition, desiredOverall, random);
    return {
      ...base,
      kind: "OUTFIELD" as const,
      primaryPosition,
      secondaryPositions: pickSecondaryPositions(primaryPosition, random),
      attributes,
      overall: calculateOutfieldOverall(primaryPosition, attributes),
    };
  });

  return {
    players,
    exceptionalPlayerId:
      exceptionalPlayerIndex === null ? null : (players[exceptionalPlayerIndex]?.id ?? null),
  };
}

function tunePlayersToOfficialStrength(
  players: readonly GeneratedPlayer[],
  formation: Formation,
  targetStrength: number,
  exceptionalPlayerId: string | null,
): GeneratedPlayer[] {
  let tuned = [...players];
  for (let pass = 0; pass < 4; pass += 1) {
    const current = selectBestLineup(formation, tuned).overall;
    const offset = Math.round(targetStrength - current);
    if (offset === 0) break;
    tuned = tuned.map((player) =>
      player.id === exceptionalPlayerId ? player : shiftPlayerOverall(player, offset),
    );
  }
  return tuned;
}

function generateOneTeam(
  team: SquadGenerationTeam,
  identities: readonly PlayerIdentity[],
  generationVersion: string,
  exceptionalPlayerIndex: number | null,
): GeneratedTeamSquad {
  const formationRandom = createSeededRandom(`${generationVersion}:${team.key}:formations`);
  const formations = shuffle(FORMATIONS, formationRandom).slice(0, 3) as [
    Formation,
    Formation,
    Formation,
  ];
  const generated = generateTeamPlayers(
    team,
    identities,
    generationVersion,
    exceptionalPlayerIndex,
  );
  const players = tunePlayersToOfficialStrength(
    generated.players,
    formations[0],
    team.targetStrength,
    generated.exceptionalPlayerId,
  );
  const labels = ["Usual XI", "Alternative A", "Alternative B"] as const;
  const lineups = formations.map((formation, index) => ({
    label: labels[index] ?? `Alternative ${index}`,
    formation,
    official: index === 0,
    ratings: selectBestLineup(formation, players),
  })) as GeneratedTeamSquad["lineups"];

  return {
    teamKey: team.key,
    targetStrength: team.targetStrength,
    strengthRating: lineups[0].ratings.overall,
    players,
    lineups,
  };
}

export interface GenerateLeagueSquadsOptions {
  generationVersion?: string;
}

export function generateLeagueSquads(
  teams: readonly SquadGenerationTeam[],
  identities: readonly PlayerIdentity[],
  options: GenerateLeagueSquadsOptions = {},
): GeneratedTeamSquad[] {
  const generationVersion = options.generationVersion ?? SQUAD_GENERATION_VERSION;
  if (!generationVersion.trim()) {
    throw new Error("generationVersion cannot be empty");
  }
  if (new Set(teams.map(({ key }) => key)).size !== teams.length) {
    throw new Error("Every team generation key must be unique");
  }
  for (const team of teams) {
    if (!team.key.trim()) throw new Error("Team generation keys cannot be empty");
    if (
      !Number.isFinite(team.targetStrength) ||
      team.targetStrength < 1 ||
      team.targetStrength > 99
    ) {
      throw new RangeError("Target strength must be between 1 and 99");
    }
  }

  const sortedTeams = [...teams].sort((left, right) => left.key.localeCompare(right.key));
  const requiredIdentities = sortedTeams.length * PLAYERS_PER_SQUAD;
  const identityPool = shuffle(
    validateIdentities(identities, requiredIdentities),
    createSeededRandom(`${generationVersion}:identities`),
  );

  const generatedByTeam = new Map<string, GeneratedTeamSquad>();
  sortedTeams.forEach((team, teamIndex) => {
    const start = teamIndex * PLAYERS_PER_SQUAD;
    const teamIdentities = identityPool.slice(start, start + PLAYERS_PER_SQUAD);
    // Four controlled exceptional players in a 20-club league.
    const exceptionalPlayerIndex =
      teamIndex % 5 === 0
        ? 3 +
          Math.floor(
            createSeededRandom(`${generationVersion}:${team.key}:exceptional`)() *
              (PLAYERS_PER_SQUAD - 3),
          )
        : null;
    generatedByTeam.set(
      team.key,
      generateOneTeam(team, teamIdentities, generationVersion, exceptionalPlayerIndex),
    );
  });

  return teams.map((team) => {
    const generated = generatedByTeam.get(team.key);
    if (!generated) throw new Error(`Squad generation failed for ${team.key}`);
    return generated;
  });
}

export function mapLegacyStrengthToTarget(
  legacyStrength: number,
  legacyMinimum = 30,
  legacyMaximum = 88,
  targetMinimum = 60,
  targetMaximum = 85,
): number {
  if (!Number.isFinite(legacyStrength)) {
    throw new TypeError("Legacy strength must be finite");
  }
  if (legacyMaximum <= legacyMinimum || targetMaximum <= targetMinimum) {
    throw new RangeError("Strength ranges must have increasing bounds");
  }
  const position = clamp((legacyStrength - legacyMinimum) / (legacyMaximum - legacyMinimum), 0, 1);
  return Math.round((targetMinimum + position * (targetMaximum - targetMinimum)) * 100) / 100;
}
