// Leave day counting. Pure. Leave is counted in working days: weekly off days inside the range are not
// counted (a Friday–Monday leave with a Sat/Sun weekend is 2 days).

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

/** Working dates in [start, end]. */
export function leaveDates(start: string, end: string, weekendDays: readonly number[]): string[] {
  return eachDate(start, end).filter((d) => !isWeekend(d, weekendDays));
}

export function countLeaveDays(start: string, end: string, weekendDays: readonly number[]): number {
  return leaveDates(start, end, weekendDays).length;
}

/** Working days of [start, end] that fall inside [from, to] (e.g. one calendar year or one payroll month). */
export function leaveDaysWithin(start: string, end: string, from: string, to: string, weekendDays: readonly number[]): number {
  const s = start > from ? start : from;
  const e = end < to ? end : to;
  return s > e ? 0 : countLeaveDays(s, e, weekendDays);
}

export type Balance = { entitlement: number | null; used: number; pending: number; remaining: number | null };

export function balanceOf(entitlement: number | null, used: number, pending: number): Balance {
  return { entitlement, used, pending, remaining: entitlement === null ? null : entitlement - used - pending };
}
