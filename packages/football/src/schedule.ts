import type { ScheduledDay } from "./types.js";

export type RandomSource = () => number;

export const EARLIEST_KICKOFF_MINUTE = 13 * 60;
export const LATEST_KICKOFF_MINUTE = 22 * 60;
export const KICKOFF_SLOT_MINUTES = 15;

export interface SchedulableTeam {
  id: string;
}

export interface RoundPairing<TTeam extends SchedulableTeam = SchedulableTeam> {
  homeTeam: TTeam;
  awayTeam: TTeam;
  homeTeamId: string;
  awayTeamId: string;
  scheduledDay: ScheduledDay;
  /** Local wall-clock minute, persisted as UTC only when the round is created. */
  scheduledMinuteOfDay: number;
}

export interface RoundScheduleOptions {
  random?: RandomSource;
}

function shuffledIndexes(length: number, random: RandomSource): number[] {
  const indexes = Array.from({ length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    const currentValue = indexes[index];
    const targetValue = indexes[target];
    if (currentValue === undefined || targetValue === undefined) {
      throw new Error("Invalid shuffle index");
    }
    indexes[index] = targetValue;
    indexes[target] = currentValue;
  }
  return indexes;
}

function randomKickoffMinutes(count: number, random: RandomSource): number[] {
  const available =
    Math.floor((LATEST_KICKOFF_MINUTE - EARLIEST_KICKOFF_MINUTE) / KICKOFF_SLOT_MINUTES) + 1;
  if (count > available) throw new RangeError("Not enough distinct kickoff slots");

  return shuffledIndexes(available, random)
    .slice(0, count)
    .map((index) => EARLIEST_KICKOFF_MINUTE + index * KICKOFF_SLOT_MINUTES)
    .sort((left, right) => left - right);
}

/** Circle-method round robin. Weeks 1..19 cover each pair once for 20 teams. */
export function getRoundSchedule<TTeam extends SchedulableTeam>(
  teams: readonly TTeam[],
  weekNumber: number,
  options: RoundScheduleOptions = {},
): RoundPairing<TTeam>[] {
  if (teams.length < 2 || teams.length % 2 !== 0) {
    throw new RangeError("Round-robin scheduling requires an even team count");
  }
  if (!Number.isInteger(weekNumber) || weekNumber <= 0) {
    throw new RangeError("weekNumber must be a positive integer");
  }
  if (new Set(teams.map(({ id }) => id)).size !== teams.length) {
    throw new Error("Every scheduled team id must be unique");
  }

  const roundsPerCycle = teams.length - 1;
  const roundIndex = (weekNumber - 1) % roundsPerCycle;
  const cycleIndex = Math.floor((weekNumber - 1) / roundsPerCycle);
  let rotation = [...teams];

  for (let round = 0; round < roundIndex; round += 1) {
    const last = rotation.at(-1);
    const fixed = rotation[0];
    if (!last || !fixed) throw new Error("Cannot rotate an empty schedule");
    rotation = [fixed, last, ...rotation.slice(1, -1)];
  }

  const rawPairs: Array<{ homeTeam: TTeam; awayTeam: TTeam }> = [];
  for (let pairIndex = 0; pairIndex < teams.length / 2; pairIndex += 1) {
    const left = rotation[pairIndex];
    const right = rotation[rotation.length - 1 - pairIndex];
    if (!left || !right) throw new Error("Round-robin pairing is incomplete");

    const reverse = (roundIndex + pairIndex + cycleIndex) % 2 === 1;
    rawPairs.push({
      homeTeam: reverse ? right : left,
      awayTeam: reverse ? left : right,
    });
  }

  if (!options.random) throw new Error("An explicit deterministic random source is required");
  const random = options.random;
  const saturdayCount = Math.floor(rawPairs.length / 2);
  const saturdayIndexes = new Set(shuffledIndexes(rawPairs.length, random).slice(0, saturdayCount));

  const scheduledDays = rawPairs.map((_, index): ScheduledDay =>
    saturdayIndexes.has(index) ? "SAT" : "SUN",
  );
  const slots: Record<ScheduledDay, number[]> = {
    SAT: randomKickoffMinutes(saturdayCount, random),
    SUN: randomKickoffMinutes(rawPairs.length - saturdayCount, random),
  };
  const nextSlot: Record<ScheduledDay, number> = { SAT: 0, SUN: 0 };

  return rawPairs.map(({ homeTeam, awayTeam }, index) => {
    const scheduledDay = scheduledDays[index];
    if (!scheduledDay) throw new Error("Round is missing a scheduled day");
    const scheduledMinuteOfDay = slots[scheduledDay][nextSlot[scheduledDay]++];
    if (scheduledMinuteOfDay === undefined) throw new Error("Round is missing a kickoff slot");
    return {
      homeTeam,
      awayTeam,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      scheduledDay,
      scheduledMinuteOfDay,
    };
  });
}
