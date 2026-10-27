export const ROUNDS_PER_SEASON = 38;
export const MATCHES_PER_ROUND = 10;
export const TOTAL_MATCHES_PER_SEASON = ROUNDS_PER_SEASON * MATCHES_PER_ROUND;

export const STANDINGS_TIE_BREAKERS = [
  "POINTS",
  "GOAL_DIFFERENCE",
  "GOALS_FOR",
  "WINS",
  "TEAM_NAME",
  "TEAM_ID",
] as const;

export type StandingFormResult = "W" | "D" | "L";
export type StandingsTieBreaker = (typeof STANDINGS_TIE_BREAKERS)[number];

export interface StandingsTeam {
  id: string;
  name: string;
  crestImageUrl: string | null;
}

export interface ResolvedStandingsMatch {
  id: string;
  weekNumber: number;
  scheduledAt: Date | string;
  resolvedAt: Date | string | null;
  homeTeamId: string;
  awayTeamId: string;
  resultPayload: unknown;
}

export interface StandingEntry {
  position: number;
  team: StandingsTeam;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  /** The team's five most recent results, oldest to newest. */
  form: StandingFormResult[];
}

export interface StandingsCalculation {
  playedMatches: number;
  goalsScored: number;
  lastResolvedAt: string | null;
  entries: StandingEntry[];
}

export interface StandingsResponse extends StandingsCalculation {
  seasonNumber: number;
  currentMatchweek: number;
  roundsPerSeason: typeof ROUNDS_PER_SEASON;
  totalMatches: typeof TOTAL_MATCHES_PER_SEASON;
  tieBreakers: StandingsTieBreaker[];
}

export interface ActiveSeason {
  seasonNumber: number;
  currentMatchweek: number;
  firstWeekNumber: number;
  lastWeekNumber: number;
}

interface MutableStanding {
  team: StandingsTeam;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: StandingFormResult[];
}

interface Score {
  homeScore: number;
  awayScore: number;
}

export function getActiveSeason(latestWeekNumber: number | null | undefined): ActiveSeason {
  if (latestWeekNumber == null) {
    return {
      seasonNumber: 1,
      currentMatchweek: 0,
      firstWeekNumber: 1,
      lastWeekNumber: ROUNDS_PER_SEASON,
    };
  }
  if (!Number.isSafeInteger(latestWeekNumber) || latestWeekNumber <= 0) {
    throw new RangeError("latestWeekNumber must be a positive whole number");
  }

  const seasonNumber = Math.floor((latestWeekNumber - 1) / ROUNDS_PER_SEASON) + 1;
  const currentMatchweek = ((latestWeekNumber - 1) % ROUNDS_PER_SEASON) + 1;
  const firstWeekNumber = (seasonNumber - 1) * ROUNDS_PER_SEASON + 1;

  return {
    seasonNumber,
    currentMatchweek,
    firstWeekNumber,
    lastWeekNumber: firstWeekNumber + ROUNDS_PER_SEASON - 1,
  };
}

export function calculateStandings(
  teams: readonly StandingsTeam[],
  resolvedMatches: readonly ResolvedStandingsMatch[],
): StandingsCalculation {
  const standings = new Map<string, MutableStanding>();
  for (const team of teams) {
    if (standings.has(team.id)) {
      throw new Error(`Duplicate team id in standings input: ${team.id}`);
    }
    standings.set(team.id, emptyStanding(team));
  }

  const matches = [...resolvedMatches].sort(compareMatchesChronologically);
  let goalsScored = 0;
  let lastResolvedAt: Date | null = null;

  for (const match of matches) {
    const home = standings.get(match.homeTeamId);
    const away = standings.get(match.awayTeamId);
    if (!home || !away) {
      throw new Error(`Resolved match ${match.id} references a team outside the standings`);
    }
    if (match.homeTeamId === match.awayTeamId) {
      throw new Error(`Resolved match ${match.id} cannot have the same team twice`);
    }

    const { homeScore, awayScore } = readScore(match);
    const resolvedAt = readDate(match.resolvedAt, match.id, "resolvedAt");
    // Validate this as well because it determines chronological form ordering.
    readDate(match.scheduledAt, match.id, "scheduledAt");
    if (!Number.isSafeInteger(match.weekNumber) || match.weekNumber <= 0) {
      throw new Error(`Resolved match ${match.id} has an invalid weekNumber`);
    }

    home.played += 1;
    away.played += 1;
    home.goalsFor += homeScore;
    home.goalsAgainst += awayScore;
    away.goalsFor += awayScore;
    away.goalsAgainst += homeScore;
    goalsScored += homeScore + awayScore;

    if (homeScore > awayScore) {
      recordWin(home);
      recordLoss(away);
    } else if (homeScore < awayScore) {
      recordLoss(home);
      recordWin(away);
    } else {
      recordDraw(home);
      recordDraw(away);
    }

    if (!lastResolvedAt || resolvedAt > lastResolvedAt) {
      lastResolvedAt = resolvedAt;
    }
  }

  const ranked = [...standings.values()].sort(compareStandings);
  const entries = ranked.map((standing, index): StandingEntry => ({
    position: index + 1,
    team: { ...standing.team },
    played: standing.played,
    wins: standing.wins,
    draws: standing.draws,
    losses: standing.losses,
    goalsFor: standing.goalsFor,
    goalsAgainst: standing.goalsAgainst,
    goalDifference: standing.goalsFor - standing.goalsAgainst,
    points: standing.points,
    form: standing.form.slice(-5),
  }));

  return {
    playedMatches: matches.length,
    goalsScored,
    lastResolvedAt: lastResolvedAt?.toISOString() ?? null,
    entries,
  };
}

function emptyStanding(team: StandingsTeam): MutableStanding {
  return {
    team: { ...team },
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    form: [],
  };
}

function recordWin(standing: MutableStanding): void {
  standing.wins += 1;
  standing.points += 3;
  standing.form.push("W");
}

function recordDraw(standing: MutableStanding): void {
  standing.draws += 1;
  standing.points += 1;
  standing.form.push("D");
}

function recordLoss(standing: MutableStanding): void {
  standing.losses += 1;
  standing.form.push("L");
}

function readScore(match: ResolvedStandingsMatch): Score {
  const payload = match.resultPayload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Resolved match ${match.id} has an invalid resultPayload`);
  }

  const { homeScore, awayScore } = payload as Record<string, unknown>;
  if (!isScore(homeScore) || !isScore(awayScore)) {
    throw new Error(
      `Resolved match ${match.id} must have non-negative whole homeScore and awayScore values`,
    );
  }
  return { homeScore, awayScore };
}

function isScore(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function readDate(
  value: Date | string | null,
  matchId: string,
  field: "scheduledAt" | "resolvedAt",
): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? "");
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Resolved match ${matchId} has an invalid ${field}`);
  }
  return date;
}

function compareMatchesChronologically(
  left: ResolvedStandingsMatch,
  right: ResolvedStandingsMatch,
): number {
  const byWeek = left.weekNumber - right.weekNumber;
  if (byWeek !== 0) return byWeek;

  const leftTime = new Date(left.scheduledAt).getTime();
  const rightTime = new Date(right.scheduledAt).getTime();
  const bySchedule = leftTime - rightTime;
  if (!Number.isNaN(bySchedule) && bySchedule !== 0) return bySchedule;
  return compareText(left.id, right.id);
}

function compareStandings(left: MutableStanding, right: MutableStanding): number {
  return (
    right.points - left.points ||
    goalDifference(right) - goalDifference(left) ||
    right.goalsFor - left.goalsFor ||
    right.wins - left.wins ||
    compareText(normalizeName(left.team.name), normalizeName(right.team.name)) ||
    compareText(left.team.id, right.team.id)
  );
}

function goalDifference(standing: MutableStanding): number {
  return standing.goalsFor - standing.goalsAgainst;
}

function normalizeName(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
