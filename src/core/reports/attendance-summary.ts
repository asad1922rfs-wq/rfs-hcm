// Monthly attendance summary for reports. Pure: no I/O.
//
// Counting rules (same as payroll, src/core/payroll/calculate.ts):
//   * "Present" is every day the employee attended: PRESENT, LATE, EARLY, HALF_DAY, SHORT_DAY and MISSING.
//     The per-status columns break that total down.
//   * Late arrivals and missing punches together: every 3 deduct one day.
//   * Each absent day deducts one full day; total deduction days = absent + late deduction days.
//   * Only days inside [from, to] are counted, so a stray record outside the month never leaks in.

import { LATES_PER_DEDUCTION_DAY, type AttendanceStatusCode } from "@/core/payroll/calculate";

export type SummaryDay = {
  workDate: string; // YYYY-MM-DD
  status: AttendanceStatusCode;
  workedMinutes: number | null;
  lateMinutes: number;
};

export type AttendanceSummary = {
  present: number;
  onTime: number;
  late: number;
  early: number;
  missing: number;
  halfOrShort: number;
  absent: number;
  leave: number;
  workedMinutes: number;
  lateMinutes: number;
  /** Late arrivals + missing punches — the count the late-deduction rule applies to. */
  lateAndMissing: number;
  lateDeductionDays: number;
  /** Absent days + late deduction days: the days payroll deducts for attendance. */
  totalDeductionDays: number;
};

export function summariseAttendance(days: readonly SummaryDay[], from: string, to: string): AttendanceSummary {
  const s: AttendanceSummary = {
    present: 0, onTime: 0, late: 0, early: 0, missing: 0, halfOrShort: 0, absent: 0, leave: 0,
    workedMinutes: 0, lateMinutes: 0, lateAndMissing: 0, lateDeductionDays: 0, totalDeductionDays: 0,
  };
  for (const d of days) {
    if (d.workDate < from || d.workDate > to) continue;
    switch (d.status) {
      case "PRESENT":
        s.onTime++;
        break;
      case "LATE":
        s.late++;
        break;
      case "EARLY":
        s.early++;
        break;
      case "MISSING":
        s.missing++;
        break;
      case "HALF_DAY":
      case "SHORT_DAY":
        s.halfOrShort++;
        break;
      case "ABSENT":
        s.absent++;
        continue;
      case "LEAVE":
        s.leave++;
        continue;
    }
    s.present++;
    s.workedMinutes += d.workedMinutes ?? 0;
    s.lateMinutes += d.lateMinutes;
  }
  s.lateAndMissing = s.late + s.missing;
  s.lateDeductionDays = Math.floor(s.lateAndMissing / LATES_PER_DEDUCTION_DAY);
  s.totalDeductionDays = s.absent + s.lateDeductionDays;
  return s;
}

/** 545 → "9:05"; null → "" */
export function hoursMinutes(minutes: number | null): string {
  if (minutes === null) return "";
  return `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;
}

/** Whole calendar month as YYYY-MM-DD bounds. */
export function monthRange(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}
