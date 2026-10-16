// Calendar-date helpers. Business dates are represented as Date objects at UTC midnight
// (that is how Prisma returns @db.Date columns), and "today" is always evaluated in Pakistan time.

import { APP_TIMEZONE } from "./format";

/** "2026-10-16" → Date at 2026-10-16T00:00:00Z. Throws on invalid input. */
export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid date "${value}"`);
  const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (d.toISOString().slice(0, 10) !== value) throw new Error(`Invalid date "${value}"`);
  return d;
}

export function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's calendar date in Pakistan time, as a UTC-midnight Date. */
export function todayInPKT(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parseDateOnly(parts);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

/**
 * Next occurrence (on or after `from`) of the month/day of `date` — used for birthdays and work anniversaries.
 * 29 Feb falls on 28 Feb in non-leap years.
 */
export function nextAnniversary(date: Date, from: Date): Date {
  const make = (year: number) => {
    const day = Math.min(date.getUTCDate(), daysInMonth(year, date.getUTCMonth() + 1));
    return new Date(Date.UTC(year, date.getUTCMonth(), day));
  };
  const thisYear = make(from.getUTCFullYear());
  return thisYear.getTime() >= from.getTime() ? thisYear : make(from.getUTCFullYear() + 1);
}

/** Whole years between two calendar dates. */
export function yearsBetween(start: Date, end: Date): number {
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  const beforeAnniversary =
    end.getUTCMonth() < start.getUTCMonth() ||
    (end.getUTCMonth() === start.getUTCMonth() && end.getUTCDate() < start.getUTCDate());
  if (beforeAnniversary) years -= 1;
  return years;
}
