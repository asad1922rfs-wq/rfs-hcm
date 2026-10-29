import { describe, expect, it } from "vitest";
import { calculatePay, type AttendanceStatusCode, type PayInput } from "@/core/payroll/calculate";
import { applyWorkFromHome, checkRequest, TRUSTED_REASONS, waiverReasonText, waiverRequestsLeft } from "@/core/attendance/waiver";
import { summariseAttendance } from "@/core/reports/attendance-summary";
import { summariseMonth } from "@/core/attendance/month-calendar";
import { DAY_STATUSES, WORKED_STATUSES } from "@/core/attendance/day-status";

// October 2026: 31 days, weekends Sat/Sun.
function octoberDays(overrides: Record<number, AttendanceStatusCode> = {}): Map<string, AttendanceStatusCode> {
  const m = new Map<string, AttendanceStatusCode>();
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) m.set(date, overrides[d] ?? "PRESENT");
  }
  return m;
}

const base: PayInput = {
  year: 2026, month: 10, today: "2026-11-05", joiningDate: "2024-01-01", exitDate: null, weekendDays: [0, 6],
  salary: { basic: 80_000, allowances: [] }, days: octoberDays(), adjustments: [],
};

describe("work from home request", () => {
  it("is a trusted reason: no hours check, counts toward the monthly limit", () => {
    expect(waiverReasonText("WORK_FROM_HOME")).toBe("Work from home");
    expect(TRUSTED_REASONS).toContain("WORK_FROM_HOME");
    expect(checkRequest("WORK_FROM_HOME", null, 540)).toEqual({ ok: true, workedMinutes: null });
    expect(checkRequest("WORK_FROM_HOME", { status: "ABSENT", workedMinutes: null }, 540).ok).toBe(true);
    expect(waiverRequestsLeft([{ workDate: "2026-10-05", status: "APPROVED" }, { workDate: "2026-10-06", status: "PENDING" }], "2026-10")).toBe(3);
  });

  it("maps a punched day to Work from home, keeping times and dropping late / early", () => {
    const firstIn = new Date("2026-10-05T09:40:00Z");
    const lastOut = new Date("2026-10-05T15:00:00Z");
    expect(applyWorkFromHome({ status: "LATE", firstIn, lastOut, punchCount: 2, workedMinutes: 320, lateMinutes: 40, earlyLeaveMinutes: 120 })).toEqual({
      status: "WORK_FROM_HOME", firstIn, lastOut, punchCount: 2, workedMinutes: 320, lateMinutes: 0, earlyLeaveMinutes: 0,
    });
  });

  it("maps a day without punches to Work from home with no times", () => {
    expect(applyWorkFromHome(null)).toEqual({
      status: "WORK_FROM_HOME", firstIn: null, lastOut: null, punchCount: 0, workedMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0,
    });
  });

  it("payroll counts it as a paid present day with no deduction", () => {
    const r = calculatePay({ ...base, days: octoberDays({ 5: "WORK_FROM_HOME", 6: "WORK_FROM_HOME" }) });
    expect(r).toMatchObject({ presentDays: 22, absentDays: 0, lateCount: 0, halfDays: 0 });
    expect(r.netPay).toBe(80_000);
  });

  it("reports count it as present plus its own WFH count", () => {
    const s = summariseAttendance([
      { workDate: "2026-10-05", status: "WORK_FROM_HOME", workedMinutes: null, lateMinutes: 0 },
      { workDate: "2026-10-06", status: "WORK_FROM_HOME", workedMinutes: 300, lateMinutes: 0 },
      { workDate: "2026-10-07", status: "PRESENT", workedMinutes: 540, lateMinutes: 0 },
    ], "2026-10-01", "2026-10-31");
    expect(s).toMatchObject({ present: 3, wfh: 2, onTime: 1, late: 0, totalDeductionDays: 0, workedMinutes: 840 });
  });

  it("month calendar summary counts it as present and work from home", () => {
    const s = summariseMonth([{ date: "2026-10-05", status: "WORK_FROM_HOME", workedMinutes: null } as never], "2026-10-31");
    expect(s).toMatchObject({ present: 1, wfh: 1 });
  });

  it("has a label, colour and worked bar", () => {
    expect(DAY_STATUSES.WORK_FROM_HOME).toEqual({ label: "Work from home", color: "var(--status-wfh)" });
    expect(WORKED_STATUSES).toContain("WORK_FROM_HOME");
  });
});
