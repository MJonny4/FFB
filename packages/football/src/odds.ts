import { MARKET_REGISTRY, type Market } from "./markets.js";
import { getMarketProbabilities } from "./probability.js";

export const DEFAULT_HOUSE_MARGIN = 0.06;
export const MINIMUM_ODDS = 1.01;

export interface OddsQuote {
  market: Market;
  selection: string;
  odds: number;
  probability: number;
}

export function probabilityToDecimalOdds(
  probability: number,
  houseMargin = DEFAULT_HOUSE_MARGIN,
): number {
  if (!Number.isFinite(probability) || probability <= 0 || probability > 1) {
    throw new RangeError("probability must be greater than 0 and at most 1");
  }
  if (!Number.isFinite(houseMargin) || houseMargin < 0 || houseMargin >= 1) {
    throw new RangeError("houseMargin must be between 0 and 1");
  }

  const rawOdds = 1 / (probability * (1 + houseMargin));
  return Math.max(MINIMUM_ODDS, Math.round(rawOdds * 100) / 100);
}

export function createOddsQuotes(
  homeStrength: number,
  awayStrength: number,
  houseMargin = DEFAULT_HOUSE_MARGIN,
): OddsQuote[] {
  const probabilities = getMarketProbabilities(homeStrength, awayStrength);
  const quotes: OddsQuote[] = [];

  for (const market of Object.keys(MARKET_REGISTRY) as Market[]) {
    for (const selection of MARKET_REGISTRY[market].selections) {
      const probability = probabilities[market][selection as never] as number;
      quotes.push({
        market,
        selection,
        probability,
        odds: probabilityToDecimalOdds(probability, houseMargin),
      });
    }
  }

  return quotes;
}
