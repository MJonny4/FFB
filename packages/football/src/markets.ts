export const MARKETS = ["MATCH_RESULT", "EXACT_SCORE", "TOTAL_CARDS", "TOTAL_CORNERS"] as const;

export type Market = (typeof MARKETS)[number];

export const MATCH_RESULT_SELECTIONS = ["HOME", "DRAW", "AWAY"] as const;
export type MatchResultSelection = (typeof MATCH_RESULT_SELECTIONS)[number];

export const EXACT_SCORE_SELECTIONS = [
  "0-0",
  "0-1",
  "0-2",
  "0-3",
  "1-0",
  "1-1",
  "1-2",
  "1-3",
  "2-0",
  "2-1",
  "2-2",
  "2-3",
  "3-0",
  "3-1",
  "3-2",
  "3-3",
  "OTHER",
] as const;
export type ExactScoreSelection = (typeof EXACT_SCORE_SELECTIONS)[number];

export const TOTAL_SELECTIONS = ["UNDER", "OVER"] as const;
export type TotalSelection = (typeof TOTAL_SELECTIONS)[number];

export const TOTAL_CARDS_LINE = 4.5;
export const TOTAL_CORNERS_LINE = 9.5;

export interface MarketDefinition {
  code: Market;
  label: string;
  selections: readonly string[];
  line?: number;
}

export const MARKET_REGISTRY = {
  MATCH_RESULT: {
    code: "MATCH_RESULT",
    label: "Match result (1X2)",
    selections: MATCH_RESULT_SELECTIONS,
  },
  EXACT_SCORE: {
    code: "EXACT_SCORE",
    label: "Exact final score",
    selections: EXACT_SCORE_SELECTIONS,
  },
  TOTAL_CARDS: {
    code: "TOTAL_CARDS",
    label: `Total cards ${TOTAL_CARDS_LINE}`,
    selections: TOTAL_SELECTIONS,
    line: TOTAL_CARDS_LINE,
  },
  TOTAL_CORNERS: {
    code: "TOTAL_CORNERS",
    label: `Total corners ${TOTAL_CORNERS_LINE}`,
    selections: TOTAL_SELECTIONS,
    line: TOTAL_CORNERS_LINE,
  },
} as const satisfies Record<Market, MarketDefinition>;

export function isMarket(value: string): value is Market {
  return (MARKETS as readonly string[]).includes(value);
}

export function getMarketSelections(market: Market): readonly string[] {
  return MARKET_REGISTRY[market].selections;
}

export function validateSelection(market: Market, selection: string): boolean {
  return getMarketSelections(market).includes(selection);
}
