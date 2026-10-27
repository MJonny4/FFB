import type { Formation, LineupUnitGroup } from "./formations.js";
import type { PlayerPosition } from "./players.js";
import type { MatchResultPayload } from "./types.js";

export const LIVE_ENGINE_VERSION = "touchline-v1";
export const LIVE_DATA_CHANNEL = "football-bets:match-changed";
export const SIMULATION_STEP_MS = 250;
export const SIMULATION_SECONDS_PER_STEP = 5;
export const HALFTIME_STEPS = 60;
export const LIVE_IDLE_INTERVAL_MS = 5_000;
export const LIVE_AUDIENCE_KEY = "football-bets:live-audience";
export const LIVE_AUDIENCE_LEASE_MS = 12_000;

export type MatchPhase = "PENDING" | "LIVE" | "HALFTIME" | "FINISHED";
export type MatchSide = "HOME" | "AWAY";
export type LiveEventType =
  | "KICKOFF"
  | "HALFTIME"
  | "SECOND_HALF_KICKOFF"
  | "FULL_TIME"
  | "ADDED_TIME"
  | "PASS"
  | "TURNOVER"
  | "ATTACK"
  | "SHOT"
  | "GOAL"
  | "SAVE"
  | "CORNER"
  | "OFFSIDE"
  | "FOUL"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "SUBSTITUTION"
  | "INJURY";

export interface SimulationPlayer {
  id: string;
  name: string;
  shirtNumber: number;
  position: PlayerPosition;
  secondaryPositions: PlayerPosition[];
  overall: number;
  slotKey: string | null;
  unit: LineupUnitGroup;
  attributes: Record<string, number>;
}

export interface SimulationTeam {
  id: string;
  name: string;
  formation: Formation;
  strength: number;
  players: SimulationPlayer[];
}

/** Stored privately. Neither seed nor these engine inputs belong in socket DTOs. */
export interface SimulationInput {
  version: typeof LIVE_ENGINE_VERSION;
  matchId: string;
  home: SimulationTeam;
  away: SimulationTeam;
}

export interface LivePlayer {
  id: string;
  name: string;
  shirtNumber: number;
  position: PlayerPosition;
  slotKey: string | null;
  unit: LineupUnitGroup;
  status: "ACTIVE" | "BENCH" | "REPLACED" | "DISMISSED" | "WITHDRAWN";
  energy: number;
  yellows: number;
  injured: boolean;
  goals: number;
}

export interface LiveStats {
  goals: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  corners: number;
  fouls: number;
  offsides: number;
  yellows: number;
  reds: number;
  cards: number;
  possessionSeconds: number;
}

export interface LiveTeamState {
  players: LivePlayer[];
  stats: LiveStats;
  mentality: "BALANCED" | "ATTACKING" | "CAUTIOUS";
  substitutions: number;
  substitutionWindows: number;
  lastSubstitutionSecond: number;
}

export interface LiveEvent {
  sequence: number;
  step: number;
  actionId: string;
  period: 1 | 2;
  second: number;
  type: LiveEventType;
  side: MatchSide | null;
  playerId: string | null;
  relatedPlayerId: string | null;
  text: string;
  important: boolean;
  outcome?: "MISS" | "BLOCK" | "SAVED" | "GOAL";
}

export interface SimulationState {
  phase: MatchPhase;
  period: 1 | 2;
  second: number;
  step: number;
  sequence: number;
  randomState: number;
  halftimeSteps: number;
  addedMinutes: [number, number];
  interruptionSeconds: number;
  possession: MatchSide;
  zone: number;
  ball: { x: number; y: number; playerId: string | null };
  pressure: number;
  home: LiveTeamState;
  away: LiveTeamState;
  lastEvent: LiveEvent | null;
}

/** Explicit public projection: never spread a persisted simulation record. */
export interface LiveMatchSummary {
  matchId: string;
  phase: MatchPhase;
  period: 1 | 2;
  second: number;
  addedMinutes: [number, number];
  revision: number;
  latestSequence: number;
  startedAt: string;
  observedAt: string;
  serverTime: string;
  settled: boolean;
  homeScore: number;
  awayScore: number;
  pressure: number;
  lastEvent: LiveEvent | null;
}

export interface LiveMatchSnapshot extends LiveMatchSummary {
  possession: MatchSide;
  ball: { x: number; y: number; playerId: string | null };
  home: LiveTeamState;
  away: LiveTeamState;
  events: LiveEvent[];
}

export interface MatchCenterTeam {
  id: string;
  name: string;
  abbreviation: string;
  primaryColor: string;
  secondaryColor: string;
  crestImageUrl: string | null;
  formation: string | null;
}

export interface MatchCenterDto {
  id: string;
  roundId: string;
  weekNumber: number;
  scheduledAt: string;
  stadiumName: string;
  homeTeam: MatchCenterTeam;
  awayTeam: MatchCenterTeam;
  live: LiveMatchSnapshot | null;
  result: MatchResultPayload | null;
  supportsLive: boolean;
}

export function formatMatchClock(second: number, period: 1 | 2, phase: MatchPhase): string {
  if (phase === "PENDING") return "Kickoff";
  if (phase === "HALFTIME") return "HT";
  if (phase === "FINISHED") return "FT";
  const end = period === 1 ? 45 : 90;
  const minute = Math.max(period === 1 ? 1 : 46, Math.ceil(second / 60));
  return minute > end ? `${end}+${minute - end}′` : `${minute}′`;
}

export function isLiveMatchSummary(value: unknown): value is LiveMatchSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<LiveMatchSummary>;
  return (
    typeof v.matchId === "string" &&
    typeof v.revision === "number" &&
    Number.isSafeInteger(v.revision) &&
    typeof v.latestSequence === "number" &&
    ["PENDING", "LIVE", "HALFTIME", "FINISHED"].includes(v.phase ?? "") &&
    typeof v.homeScore === "number" &&
    typeof v.awayScore === "number" &&
    typeof v.second === "number" &&
    (v.period === 1 || v.period === 2) &&
    typeof v.settled === "boolean" &&
    typeof v.serverTime === "string"
  );
}

export function isNewerLive(
  current: LiveMatchSummary | null | undefined,
  next: LiveMatchSummary,
): boolean {
  return (
    !current ||
    next.revision > current.revision ||
    (next.revision === current.revision && next.settled && !current.settled)
  );
}
