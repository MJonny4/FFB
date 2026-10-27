import { TOTAL_CARDS_LINE, TOTAL_CORNERS_LINE, type Market, validateSelection } from "./markets.js";
import type { MatchResultPayload } from "./types.js";

function assertResult(result: MatchResultPayload): void {
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`result.${key} must be a non-negative integer`);
    }
  }
}

export function gradeBet(market: Market, selection: string, result: MatchResultPayload): boolean {
  if (!validateSelection(market, selection)) {
    throw new RangeError(`Invalid selection ${selection} for market ${market}`);
  }
  assertResult(result);

  switch (market) {
    case "MATCH_RESULT":
      if (selection === "HOME") return result.homeScore > result.awayScore;
      if (selection === "DRAW") return result.homeScore === result.awayScore;
      return result.homeScore < result.awayScore;

    case "EXACT_SCORE": {
      const gridSelection =
        result.homeScore <= 3 && result.awayScore <= 3
          ? `${result.homeScore}-${result.awayScore}`
          : "OTHER";
      return selection === gridSelection;
    }

    case "TOTAL_CARDS": {
      const total = result.homeCards + result.awayCards;
      return selection === "OVER" ? total > TOTAL_CARDS_LINE : total < TOTAL_CARDS_LINE;
    }

    case "TOTAL_CORNERS": {
      const total = result.homeCorners + result.awayCorners;
      return selection === "OVER" ? total > TOTAL_CORNERS_LINE : total < TOTAL_CORNERS_LINE;
    }
  }
}

export type DecimalLike = number | string | { toString(): string };

/** Four-place accepted odds are multiplied as integers, never floating money. */
export function calculatePayout(stake: number, odds: DecimalLike): number {
  if (!Number.isSafeInteger(stake) || stake <= 0) throw new RangeError("Invalid stake");
  const text = odds.toString();
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new RangeError("Invalid odds precision");
  const [whole = "0", fraction = ""] = text.split(".");
  const scaled = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
  if (scaled < 10000n) throw new RangeError("Invalid odds");
  const payout = (BigInt(stake) * scaled) / 10000n;
  if (payout > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("Payout overflow");
  return Number(payout);
}
