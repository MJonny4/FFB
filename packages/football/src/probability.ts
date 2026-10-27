import {
  EXACT_SCORE_SELECTIONS,
  type ExactScoreSelection,
  type MatchResultSelection,
  type TotalSelection,
} from "./markets.js";

export const DEFAULT_HOME_ADVANTAGE_ELO = 60;
export const STRENGTH_TO_ELO = 4;

export interface MatchProbabilityModel {
  homeWinExpectation: number;
  homeGoals: number;
  awayGoals: number;
  homeCards: number;
  awayCards: number;
  homeCorners: number;
  awayCorners: number;
}

export interface MarketProbabilities {
  MATCH_RESULT: Record<MatchResultSelection, number>;
  EXACT_SCORE: Record<ExactScoreSelection, number>;
  TOTAL_CARDS: Record<TotalSelection, number>;
  TOTAL_CORNERS: Record<TotalSelection, number>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function assertStrength(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new RangeError(`${label} must be between 1 and 100`);
  }
}

/**
 * Converts the manually seeded 1..100 ratings to an Elo expectation and then
 * derives all count intensities from that one strength model. Odds and the stub
 * engine deliberately consume this same output.
 */
export function getMatchProbabilityModel(
  homeStrength: number,
  awayStrength: number,
  homeAdvantageElo = DEFAULT_HOME_ADVANTAGE_ELO,
): MatchProbabilityModel {
  assertStrength(homeStrength, "homeStrength");
  assertStrength(awayStrength, "awayStrength");

  const eloDifference = (homeStrength - awayStrength) * STRENGTH_TO_ELO + homeAdvantageElo;
  const homeWinExpectation = 1 / (1 + 10 ** (-eloDifference / 400));
  const goalTotal = 2.7;
  const homeGoals = clamp(goalTotal * homeWinExpectation, 0.25, 3.7);
  const awayGoals = clamp(goalTotal * (1 - homeWinExpectation), 0.25, 3.5);
  const rawStrengthDifference = homeStrength - awayStrength;

  return {
    homeWinExpectation,
    homeGoals,
    awayGoals,
    homeCards: clamp(2.15 - rawStrengthDifference * 0.004, 1.2, 3.2),
    awayCards: clamp(2.25 + rawStrengthDifference * 0.004, 1.2, 3.2),
    homeCorners: clamp(5.1 + rawStrengthDifference * 0.025, 2.5, 8),
    awayCorners: clamp(4.6 - rawStrengthDifference * 0.02, 2.5, 7.5),
  };
}

export function poissonProbability(lambda: number, value: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) {
    throw new RangeError("lambda must be positive");
  }
  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }

  let probability = Math.exp(-lambda);
  for (let current = 1; current <= value; current += 1) {
    probability *= lambda / current;
  }
  return probability;
}

export function poissonCdf(lambda: number, maximum: number): number {
  if (!Number.isInteger(maximum)) {
    throw new TypeError("maximum must be an integer");
  }
  if (maximum < 0) {
    return 0;
  }

  let total = 0;
  for (let value = 0; value <= maximum; value += 1) {
    total += poissonProbability(lambda, value);
  }
  return clamp(total, 0, 1);
}

function getResultProbabilities(
  homeLambda: number,
  awayLambda: number,
): Record<MatchResultSelection, number> {
  // Twelve goals captures effectively all mass for the bounded lambdas above.
  const maximumGoals = 12;
  let home = 0;
  let draw = 0;
  let away = 0;

  for (let homeScore = 0; homeScore <= maximumGoals; homeScore += 1) {
    const homeProbability = poissonProbability(homeLambda, homeScore);
    for (let awayScore = 0; awayScore <= maximumGoals; awayScore += 1) {
      const probability = homeProbability * poissonProbability(awayLambda, awayScore);
      if (homeScore > awayScore) home += probability;
      else if (homeScore === awayScore) draw += probability;
      else away += probability;
    }
  }

  const captured = home + draw + away;
  return {
    HOME: home / captured,
    DRAW: draw / captured,
    AWAY: away / captured,
  };
}

export function getMarketProbabilities(
  homeStrength: number,
  awayStrength: number,
): MarketProbabilities {
  const model = getMatchProbabilityModel(homeStrength, awayStrength);
  const exactEntries: Array<[ExactScoreSelection, number]> = [];
  let enumeratedExactProbability = 0;

  for (const selection of EXACT_SCORE_SELECTIONS) {
    if (selection === "OTHER") continue;
    const [homeText, awayText] = selection.split("-");
    const homeScore = Number(homeText);
    const awayScore = Number(awayText);
    const probability =
      poissonProbability(model.homeGoals, homeScore) *
      poissonProbability(model.awayGoals, awayScore);
    exactEntries.push([selection, probability]);
    enumeratedExactProbability += probability;
  }
  exactEntries.push(["OTHER", Math.max(0, 1 - enumeratedExactProbability)]);

  const totalCardsLambda = model.homeCards + model.awayCards;
  const cardsUnder = poissonCdf(totalCardsLambda, 4);
  const totalCornersLambda = model.homeCorners + model.awayCorners;
  const cornersUnder = poissonCdf(totalCornersLambda, 9);

  return {
    MATCH_RESULT: getResultProbabilities(model.homeGoals, model.awayGoals),
    EXACT_SCORE: Object.fromEntries(exactEntries) as Record<ExactScoreSelection, number>,
    TOTAL_CARDS: { UNDER: cardsUnder, OVER: 1 - cardsUnder },
    TOTAL_CORNERS: { UNDER: cornersUnder, OVER: 1 - cornersUnder },
  };
}
