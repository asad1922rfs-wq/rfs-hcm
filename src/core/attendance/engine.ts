// Attendance engine: turns raw punches into a work-day result. Pure functions, no I/O.
//
// Rules (configurable through the shift and its weekday overrides, e.g. Friday 3 PM – 12 AM):
//   * The first punch of the work day is check-in and the last is check-out. The device's IN/OUT key is ignored.
//   * Punches within DUPLICATE_WINDOW_MIN of each other are one punch (double taps).
//   * Late  = check-in later than shift start + grace. Late minutes are measured from shift start.
//   * Early = check-out before shift end.
//   * A single punch is MISSING (check-in or check-out not recorded).
//   * Punches on an off day are PRESENT with no late/early.
//   * Half-day and short-day thresholds are not applied until RFS confirms them.

export const PKT_OFFSET_MIN = 5 * 60; // Asia/Karachi is UTC+5 with no daylight saving
const DUPLICATE_WINDOW_MIN = 2;
/** Punches this long before shift start still belong to that work day. */
const WINDOW_BEFORE_START_MIN = 4 * 60;
/** Punches this long after shift end still belong to that work day (covers late check-outs after midnight). */
const WINDOW_AFTER_END_MIN = 7 * 60;

export type ShiftRule = { startMinute: number; endMinute: number; graceMinutes: number };

export type DayResult = {
  status: "PRESENT" | "LATE" | "EARLY" | "MISSING";
  firstIn: Date;
  lastOut: Date | null;
  punchCount: number;
  workedMinutes: number | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
};

/** Shift end relative to the work date's midnight; ≥ 1440 when the shift ends at or after midnight. */
export function shiftEndOffset(shift: Pick<ShiftRule, "startMinute" | "endMinute">): number {
  return shift.endMinute > shift.startMinute ? shift.endMinute : shift.endMinute + 1440;
}

/** "YYYY-MM-DD" of the local (PKT) calendar day of an instant, plus minutes after local midnight. */
export function toLocal(instant: Date): { date: string; minute: number } {
  const local = new Date(instant.getTime() + PKT_OFFSET_MIN * 60_000);
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** UTC instant of local midnight for a work date. */
export function localMidnight(date: string): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) - PKT_OFFSET_MIN * 60_000);
}

export function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A shift with optional weekday-specific timings (e.g. Friday 3 PM – 12 AM). */
export type DayAwareShift = ShiftRule & {
  overrides?: readonly { weekday: number; startMinute: number; endMinute: number; graceMinutes: number | null }[];
};

/** The timing that applies on a given work date. Overrides without their own grace use the shift's grace. */
export function ruleForDate(shift: DayAwareShift, date: string): ShiftRule {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const o = shift.overrides?.find((x) => x.weekday === weekday);
  if (o) return { startMinute: o.startMinute, endMinute: o.endMinute, graceMinutes: o.graceMinutes ?? shift.graceMinutes };
  return { startMinute: shift.startMinute, endMinute: shift.endMinute, graceMinutes: shift.graceMinutes };
}

/**
 * Which work date a punch belongs to: early-morning punches that fall inside the previous day's window
 * (and before today's window opens) go to the previous day. Each day uses its own timing.
 */
export function workDateOf(instant: Date, shift: DayAwareShift): string {
  const { date, minute } = toLocal(instant);
  const prev = addDaysIso(date, -1);
  const prevWindowEnd = shiftEndOffset(ruleForDate(shift, prev)) + WINDOW_AFTER_END_MIN;
  const todayWindowStart = ruleForDate(shift, date).startMinute - WINDOW_BEFORE_START_MIN;
  if (minute < todayWindowStart && minute + 1440 <= prevWindowEnd) return prev;
  return date;
}

/** UTC instant of a local time on a work date; minutes ≥ 1440 fall on the next calendar day. */
export function instantAt(workDate: string, minuteOfDay: number): Date {
  return new Date(localMidnight(workDate).getTime() + minuteOfDay * 60_000);
}

/** A machine punch counts as the check-out only if it is at least this long after the check-in. */
const MIN_SHIFT_FOR_CHECKOUT_MIN = 60;

/**
 * Effective punches for a day after a manual adjustment. The adjusted check-in replaces the machine's first
 * punch; the adjusted check-out replaces the last. Without an adjusted check-out, the latest machine punch at
 * least an hour after check-in is used.
 */
export function applyAdjustment(machine: readonly Date[], adj: { checkIn: Date | null; checkOut: Date | null }): Date[] {
  const sorted = [...machine].sort((a, b) => a.getTime() - b.getTime());
  // With an adjusted check-out, only machine punches well before it can be the check-in.
  const inCandidates = adj.checkOut ? sorted.filter((p) => p.getTime() <= adj.checkOut!.getTime() - MIN_SHIFT_FOR_CHECKOUT_MIN * 60_000) : sorted;
  const checkIn = adj.checkIn ?? inCandidates[0] ?? null;
  let checkOut = adj.checkOut;
  if (!checkOut && checkIn) {
    const later = sorted.filter((p) => p.getTime() >= checkIn.getTime() + MIN_SHIFT_FOR_CHECKOUT_MIN * 60_000);
    checkOut = later[later.length - 1] ?? null;
  }
  return [checkIn, checkOut].filter((d): d is Date => d !== null);
}

/** Drop punches within DUPLICATE_WINDOW_MIN of the previously kept punch. */
export function dedupePunches(punches: readonly Date[]): Date[] {
  const sorted = [...punches].sort((a, b) => a.getTime() - b.getTime());
  const out: Date[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (!last || p.getTime() - last.getTime() >= DUPLICATE_WINDOW_MIN * 60_000) out.push(p);
  }
  return out;
}

/**
 * `inProgress`: the work day has not ended yet (today). A single punch then means "checked in"
 * (present or late) rather than a missing check-out.
 */
export function computeDay(workDate: string, punches: readonly Date[], shift: ShiftRule, isOffDay: boolean, inProgress = false): DayResult | null {
  const kept = dedupePunches(punches);
  const first = kept[0];
  if (!first) return null;

  const midnight = localMidnight(workDate).getTime();
  const minuteOf = (d: Date) => Math.round((d.getTime() - midnight) / 60_000);
  const inMinute = minuteOf(first);
  const lateMinutes = isOffDay ? 0 : Math.max(0, inMinute - shift.startMinute);

  if (kept.length === 1) {
    if (inProgress) {
      const status = !isOffDay && lateMinutes > shift.graceMinutes ? "LATE" : "PRESENT";
      return { status, firstIn: first, lastOut: null, punchCount: 1, workedMinutes: null, lateMinutes, earlyLeaveMinutes: 0 };
    }
    return { status: "MISSING", firstIn: first, lastOut: null, punchCount: 1, workedMinutes: null, lateMinutes, earlyLeaveMinutes: 0 };
  }

  const last = kept[kept.length - 1]!;
  const workedMinutes = Math.round((last.getTime() - first.getTime()) / 60_000);
  const earlyLeaveMinutes = isOffDay ? 0 : Math.max(0, shiftEndOffset(shift) - minuteOf(last));
  const status = isOffDay ? "PRESENT" : lateMinutes > shift.graceMinutes ? "LATE" : earlyLeaveMinutes > 0 ? "EARLY" : "PRESENT";

  return { status, firstIn: first, lastOut: last, punchCount: kept.length, workedMinutes, lateMinutes, earlyLeaveMinutes };
}
