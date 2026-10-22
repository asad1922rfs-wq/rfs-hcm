// Attendance (late waiver) requests: pure rules, no I/O.
//
// An employee asks for a late arrival to be waived. Approval is allowed only when the day's worked time
// (first check-in to last check-out, after any edit) covers the full shift length; the day then counts as
// Present instead of Late, so it does not feed payroll's "every 3 lates = 1 day" deduction.

import { formatHoursMinutes } from "./month-calendar";
import { shiftEndOffset, type DayResult, type ShiftRule } from "./engine";

export const WAIVER_REASONS = [
  { key: "FULL_HOURS", text: "I completed my full shift hours (9 hours)" },
  { key: "STAYED_LATE", text: "I came late and stayed late to cover my hours" },
  { key: "MACHINE_ISSUE", text: "Forgot to punch / machine issue" },
  { key: "PRIOR_PERMISSION", text: "Late with prior permission from my manager" },
] as const;
export type WaiverReasonKey = (typeof WAIVER_REASONS)[number]["key"];
export const WAIVER_REASON_KEYS = WAIVER_REASONS.map((r) => r.key) as [WaiverReasonKey, ...WaiverReasonKey[]];

export const waiverReasonText = (key: string): string | null => WAIVER_REASONS.find((r) => r.key === key)?.text ?? null;

/** Requests per employee per calendar month (by the request's date), pending + approved. */
export const MONTHLY_WAIVER_LIMIT = 5;
export const MAX_WAIVER_NOTE = 300;

/** Requests left in a month ("YYYY-MM"); rejected and cancelled requests do not count. */
export function waiverRequestsLeft(requests: readonly { workDate: string; status: string }[], month: string, limit = MONTHLY_WAIVER_LIMIT): number {
  const used = requests.filter((r) => r.workDate.slice(0, 7) === month && (r.status === "PENDING" || r.status === "APPROVED")).length;
  return Math.max(0, limit - used);
}

/** Shift length in minutes for the day's timing (e.g. 2 PM – 11 PM = 540). */
export function requiredShiftMinutes(rule: Pick<ShiftRule, "startMinute" | "endMinute">): number {
  return shiftEndOffset(rule) - rule.startMinute;
}

export type WaiverCheck = { ok: true; workedMinutes: number } | { ok: false; workedMinutes: number | null; message: string };

/**
 * Can a late waiver be approved for this day? Only a Late day with both check-in and check-out, whose worked
 * time is at least the shift length. A missing punch must first be corrected by HR (Attendance → Edit).
 */
export function checkWaiverHours(day: { status: string; workedMinutes: number | null } | null, requiredMinutes: number): WaiverCheck {
  if (!day) return { ok: false, workedMinutes: null, message: "There is no attendance for this day yet, so the hours can't be verified. Correct the times first, or reject." };
  if (day.workedMinutes === null) {
    return { ok: false, workedMinutes: null, message: "The check-in or check-out is missing, so the hours can't be verified. Ask HR to fix the times via Attendance → Edit first, then approve — or reject." };
  }
  if (day.status !== "LATE") return { ok: false, workedMinutes: day.workedMinutes, message: "This day is not marked late — there is nothing to waive. Reject the request instead." };
  if (day.workedMinutes < requiredMinutes) {
    return {
      ok: false, workedMinutes: day.workedMinutes,
      message: `Only ${formatHoursMinutes(day.workedMinutes)} worked of ${formatHoursMinutes(requiredMinutes)} — can't waive the late. Reject, or correct the times first.`,
    };
  }
  return { ok: true, workedMinutes: day.workedMinutes };
}

/**
 * An approved waiver: a Late day counts as Present (Early if it also left early). Late minutes are kept for
 * information. Days that are not Late, or without an approved waiver, are unchanged.
 */
export function applyLateWaiver(result: DayResult, waived: boolean): DayResult {
  if (!waived || result.status !== "LATE") return result;
  return { ...result, status: result.earlyLeaveMinutes > 0 ? "EARLY" : "PRESENT" };
}
