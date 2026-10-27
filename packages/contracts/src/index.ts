import { z } from "zod";
import { FORMATIONS, MARKETS, PLAYER_POSITIONS, validateSelection } from "@ffb/football";
export { z };
export const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9:_-]+$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const password = z.string().min(12).max(128);
export const profileInput = z
  .object({
    username: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[a-z][a-z0-9_]+$/)
      .refine((v) => !["me", "admin", "api", "auth"].includes(v)),
    displayName: z.string().trim().min(1).max(60),
  })
  .strict();
export const loginInput = z.object({ email, password: z.string().min(1).max(128) }).strict();
export const signupInput = profileInput.extend({ email, password });
export const tokenInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const resetInput = tokenInput.extend({ password });
export const forgotInput = z.object({ email }).strict();
export const changePasswordInput = z
  .object({ currentPassword: z.string().max(128), newPassword: password })
  .strict();
export const deactivateInput = z.object({ password: z.string().max(128) }).strict();
export const betInput = z
  .object({
    matchId: id,
    market: z.enum(MARKETS),
    selection: z.string().max(20),
    stake: z.number().int().positive().max(1000000),
    requestId: z.uuid(),
  })
  .strict()
  .refine((v) => validateSelection(v.market, v.selection), "Invalid selection");
export type BetInput = z.infer<typeof betInput>;
export const lineupInput = z
  .object({
    formation: z.enum(FORMATIONS),
    assignments: z.array(z.object({ slotKey: id, playerId: id }).strict()).length(11),
  })
  .strict();
export type LineupInput = z.infer<typeof lineupInput>;
export const userSchema = profileInput.extend({
  id,
  email,
  coinBalance: integer,
  verified: z.boolean(),
  teamId: id.nullable(),
  avatarUrl: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;
export const resultSchema = z.object({
  homeScore: integer,
  awayScore: integer,
  homeCards: integer,
  awayCards: integer,
  homeCorners: integer,
  awayCorners: integer,
});
export const teamSchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  abbreviation: z.string(),
  shortName: z.string(),
  city: z.string(),
  stadiumName: z.string(),
  foundedYear: integer,
  primaryColor: z.string(),
  secondaryColor: z.string(),
  shirtTextColor: z.string(),
  crestImageUrl: z.string(),
  strengthRating: z.number(),
  manager: z.object({ username: z.string(), displayName: z.string() }).nullable(),
});
export type Team = z.infer<typeof teamSchema>;
const playerBase = {
  id,
  generationKey: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  nationalityCode: z.string(),
  shirtNumber: integer,
  overall: integer,
  primaryPosition: z.enum(PLAYER_POSITIONS),
  secondaryPositions: z.array(z.enum(PLAYER_POSITIONS)),
  attributes: z.record(z.string(), z.number()),
};
export const playerSchema = z.object({ ...playerBase, kind: z.enum(["GOALKEEPER", "OUTFIELD"]) });
export const teamDetailSchema = teamSchema.extend({
  squad: z.array(playerSchema),
  official: lineupInput,
  alternatives: z.array(lineupInput),
  draft: lineupInput.nullable(),
});
export type TeamDetail = z.infer<typeof teamDetailSchema>;
export const quoteSchema = z.object({
  market: z.enum(MARKETS),
  selection: z.string(),
  odds: z.string(),
});
export const matchSchema = z.object({
  id,
  roundId: id,
  weekNumber: integer,
  scheduledAt: z.iso.datetime(),
  lineupLocksAt: z.iso.datetime(),
  bettingClosesAt: z.iso.datetime(),
  status: z.enum(["SCHEDULED", "RESOLVED"]),
  homeTeam: teamSchema,
  awayTeam: teamSchema,
  result: resultSchema.nullable(),
  revision: integer,
  quotes: z.array(quoteSchema),
});
export type Match = z.infer<typeof matchSchema>;
export const roundSchema = z.object({
  id,
  weekNumber: integer,
  status: z.enum(["OPEN", "CLOSED", "SETTLED"]),
  opensAt: z.iso.datetime(),
  bettingClosesAt: z.iso.datetime(),
  matches: z.array(matchSchema),
});
export const betSchema = z.object({
  id,
  matchId: id,
  market: z.enum(MARKETS),
  selection: z.string(),
  stake: integer,
  oddsTaken: z.string(),
  status: z.enum(["PENDING", "WON", "LOST", "CANCELLED"]),
  payout: integer.nullable(),
  createdAt: z.iso.datetime(),
});
export type Bet = z.infer<typeof betSchema>;
export const ledgerSchema = z.object({
  id,
  amount: z.number().int(),
  balanceAfter: integer,
  type: z.enum(["TOPUP", "STAKE", "REFUND", "PAYOUT"]),
  reference: z.string(),
  createdAt: z.iso.datetime(),
});
export const standingSchema = z.object({
  position: integer,
  team: teamSchema,
  played: integer,
  wins: integer,
  draws: integer,
  losses: integer,
  goalsFor: integer,
  goalsAgainst: integer,
  goalDifference: z.number().int(),
  points: integer,
  form: z.array(z.enum(["W", "D", "L"])),
});
export const leaderboardSchema = z.object({
  rank: integer,
  username: z.string(),
  displayName: z.string(),
  coinBalance: integer,
  settledBets: integer,
  wins: integer,
  losses: integer,
  pendingBets: integer,
  netProfit: z.number().int(),
  roiPercent: z.number().nullable(),
  hitRatePercent: z.number().nullable(),
  provisional: z.boolean(),
});
export const publicProfileSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  team: teamSchema.nullable(),
});
export const eventSchema = z.object({
  sequence: integer,
  step: integer,
  actionId: z.string(),
  period: z.union([z.literal(1), z.literal(2)]),
  second: integer,
  type: z.enum([
    "KICKOFF",
    "HALFTIME",
    "SECOND_HALF_KICKOFF",
    "FULL_TIME",
    "ADDED_TIME",
    "PASS",
    "TURNOVER",
    "ATTACK",
    "SHOT",
    "GOAL",
    "SAVE",
    "CORNER",
    "OFFSIDE",
    "FOUL",
    "YELLOW_CARD",
    "RED_CARD",
    "SUBSTITUTION",
    "INJURY",
  ]),
  side: z.enum(["HOME", "AWAY"]).nullable(),
  playerId: id.nullable(),
  relatedPlayerId: id.nullable(),
  text: z.string(),
  important: z.boolean(),
  outcome: z.enum(["MISS", "BLOCK", "SAVED", "GOAL"]).optional(),
});
const stats = z.object({
  goals: integer,
  shots: integer,
  shotsOnTarget: integer,
  saves: integer,
  corners: integer,
  fouls: integer,
  offsides: integer,
  yellows: integer,
  reds: integer,
  cards: integer,
  possessionSeconds: integer,
});
const livePlayer = z.object({
  id,
  name: z.string(),
  shirtNumber: integer,
  position: z.enum(PLAYER_POSITIONS),
  slotKey: z.string().nullable(),
  unit: z.enum(["GK", "DEF", "MID", "ATT"]),
  status: z.enum(["ACTIVE", "BENCH", "REPLACED", "DISMISSED", "WITHDRAWN"]),
  energy: z.number(),
  yellows: integer,
  injured: z.boolean(),
  goals: integer,
});
const liveTeam = z.object({
  players: z.array(livePlayer),
  stats,
  mentality: z.enum(["BALANCED", "ATTACKING", "CAUTIOUS"]),
  substitutions: integer,
  substitutionWindows: integer,
  lastSubstitutionSecond: z.number(),
});
export const liveSchema = z.object({
  phase: z.enum(["PENDING", "LIVE", "HALFTIME", "FINISHED"]),
  period: z.union([z.literal(1), z.literal(2)]),
  second: integer,
  step: integer,
  sequence: integer,
  addedMinutes: z.tuple([integer, integer]),
  possession: z.enum(["HOME", "AWAY"]),
  ball: z.object({ x: z.number(), y: z.number(), playerId: id.nullable() }),
  pressure: z.number(),
  home: liveTeam,
  away: liveTeam,
  lastEvent: eventSchema.nullable(),
});
export const matchCenterSchema = z.object({
  match: matchSchema,
  formations: z.object({ home: z.enum(FORMATIONS), away: z.enum(FORMATIONS) }),
  live: liveSchema.nullable(),
  events: z.array(eventSchema),
});
export type MatchCenter = z.infer<typeof matchCenterSchema>;
export const clientMessage = z.discriminatedUnion("type", [
  z
    .object({ v: z.literal(1), type: z.literal("subscribe"), matchId: id, afterRevision: integer })
    .strict(),
  z.object({ v: z.literal(1), type: z.literal("unsubscribe") }).strict(),
  z.object({ v: z.literal(1), type: z.literal("ping") }).strict(),
]);
export const serverMessage = z.discriminatedUnion("type", [
  z.object({ v: z.literal(1), type: z.literal("ready") }),
  z.object({ v: z.literal(1), type: z.literal("pong") }),
  z.object({
    v: z.literal(1),
    type: z.literal("changed"),
    matchId: id.nullable(),
    revision: integer,
  }),
  z.object({ v: z.literal(1), type: z.literal("error"), message: z.string() }),
]);
