/** Madrid wall times, converted via Intl so calendar days survive DST changes. */
export function madridTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const n = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value);
    const shown = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
    const next = instant + wall - shown;
    if (next === instant) return new Date(instant);
    instant = next;
  }
  throw new RangeError("Ambiguous or invalid Madrid wall time");
}
export function roundCalendar(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const n = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const local = new Date(Date.UTC(n("year"), n("month") - 1, n("day")));
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  const day = (offset: number, hour: number, minute = 0) =>
    madridTime(
      local.getUTCFullYear(),
      local.getUTCMonth() + 1,
      local.getUTCDate() + offset,
      hour,
      minute,
    );
  return {
    key: local.toISOString().slice(0, 10),
    opensAt: day(0, 9),
    closesAt: day(4, 23, 59),
    nextOpen: day(7, 9),
    kickoff: (weekend: "SAT" | "SUN", minutes: number) =>
      day(weekend === "SAT" ? 5 : 6, Math.floor(minutes / 60), minutes % 60),
  };
}
