// Leave day counting. Pure. Leave is counted in working days: weekly off days and public holidays inside the
// range are not counted (a Friday–Monday leave with a Sat/Sun weekend is 2 days).

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function isWeekend(date: string, weekendDays: readonly number[]): boolean {
  return weekendDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

/** Weekly off day or public holiday (holidays as "YYYY-MM-DD"). */
export function isOffDay(date: string, weekendDays: readonly number[], holidays?: ReadonlySet<string>): boolean {
  return isWeekend(date, weekendDays) || !!holidays?.has(date);
}

/** Working dates in [start, end]. */
export function leaveDates(start: string, end: string, weekendDays: readonly number[], holidays?: ReadonlySet<string>): string[] {
  return eachDate(start, end).filter((d) => !isOffDay(d, weekendDays, holidays));
}

export function countLeaveDays(start: string, end: string, weekendDays: readonly number[], holidays?: ReadonlySet<string>): number {
  return leaveDates(start, end, weekendDays, holidays).length;
}

/** Working days of [start, end] that fall inside [from, to] (e.g. one calendar year or one payroll month). */
export function leaveDaysWithin(start: string, end: string, from: string, to: string, weekendDays: readonly number[], holidays?: ReadonlySet<string>): number {
  const s = start > from ? start : from;
  const e = end < to ? end : to;
  return s > e ? 0 : countLeaveDays(s, e, weekendDays, holidays);
}

export type Balance = { entitlement: number | null; used: number; pending: number; remaining: number | null };

export function balanceOf(entitlement: number | null, used: number, pending: number): Balance {
  return { entitlement, used, pending, remaining: entitlement === null ? null : entitlement - used - pending };
}
