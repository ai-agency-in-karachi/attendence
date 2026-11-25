/**
 * Calendar-date helpers that respect a school's (or the platform's) time zone.
 *
 * "Date only" values (attendance day, payment date) are passed around as
 * "YYYY-MM-DD" strings and stored in PostgreSQL `date` columns as UTC
 * midnight, so no time zone can shift them by a day.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's calendar date in the given IANA time zone, e.g. "2026-11-25". */
export function todayInZone(timeZone: string, at = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
export function isDateOnly(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "YYYY-MM-DD" -> Date for a Prisma `@db.Date` field (UTC midnight). */
export function dateOnlyToDb(s: string): Date {
  if (!isDateOnly(s)) throw new Error(`Invalid date: ${s}`);
  return new Date(`${s}T00:00:00.000Z`);
}

/** Prisma `@db.Date` value -> "YYYY-MM-DD". */
export function dbToDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Offset of a time zone from UTC at a given moment, in milliseconds. */
function zoneOffsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The exact moment a calendar day starts in a time zone (e.g. midnight in Karachi, as UTC). */
export function startOfDayInZone(dateOnly: string, timeZone: string): Date {
  const guess = dateOnlyToDb(dateOnly).getTime();
  let t = guess - zoneOffsetMs(timeZone, new Date(guess));
  // Second pass corrects days where the offset changes (daylight saving).
  t = guess - zoneOffsetMs(timeZone, new Date(t));
  return new Date(t);
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(dateOnly: string, days: number): string {
  const d = dateOnlyToDb(dateOnly);
  d.setUTCDate(d.getUTCDate() + days);
  return dbToDateOnly(d);
}

/** Adds calendar months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(dateOnly: string, months: number): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return dbToDateOnly(target);
}

/** "2026-11" for a YYYY-MM-DD date. */
export function monthOf(dateOnly: string): string {
  return dateOnly.slice(0, 7);
}

export function isMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) && Number(s.slice(0, 4)) >= 2000 && Number(s.slice(0, 4)) <= 2100;
}

/** Every date of a month ("2026-02" -> ["2026-02-01", ... "2026-02-28"]). */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Previous / next month of "YYYY-MM". */
export function shiftMonth(month: string, delta: number): string {
  return addMonths(`${month}-01`, delta).slice(0, 7);
}

/** 0 = Sunday ... 6 = Saturday, for a YYYY-MM-DD date. */
export function weekday(dateOnly: string): number {
  return dateOnlyToDb(dateOnly).getUTCDay();
}

/** "November 2026" */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(dateOnlyToDb(`${month}-01`));
}

/** "Wed, 25 Nov 2026" for a YYYY-MM-DD date. */
export function dateOnlyLabel(dateOnly: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    dateOnlyToDb(dateOnly),
  );
}

/** "14:05" in a time zone. */
export function timeInZone(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(at);
}
