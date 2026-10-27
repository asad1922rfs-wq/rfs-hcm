import { describe, expect, it } from "vitest";
import { calculatePay, type AttendanceStatusCode, type PayInput } from "@/core/payroll/calculate";
import { earnedToDate } from "@/core/payroll/earned-to-date";
import { payslipLineLabel } from "@/core/payroll/payslip-labels";
import { checkHalfDay, checkRequest, waiverReasonText, waiverRequestsLeft } from "@/core/attendance/waiver";
import { monthRange, summariseAttendance } from "@/core/reports/attendance-summary";

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
  salary: { basic: 80_000, allowances: [{ name: "Fuel", amount: 5_000 }] }, days: octoberDays(), adjustments: [],
};

describe("payroll half days", () => {
  it("each half day deducts 0.5 × the per-day rate", () => {
    const r = calculatePay({ ...base, days: octoberDays({ 5: "HALF_DAY", 6: "HALF_DAY" }) });
    expect(r).toMatchObject({ halfDays: 2, approvedHalfDays: 0, presentDays: 22, lateCount: 0 });
    const line = r.lines.find((l) => l.code === "HALF_DAY")!;
    expect(line.label).toBe("Half day 2 × 0.5 × 2741.94");
    expect(line.amount).toBe(2742);
    expect(r.netPay).toBe(85_000 - 2742);
  });

  it("an approved half-day request removes that day's deduction", () => {
    const r = calculatePay({ ...base, days: octoberDays({ 5: "HALF_DAY", 6: "HALF_DAY" }), approvedHalfDayDates: new Set(["2026-10-05"]) });
    expect(r).toMatchObject({ halfDays: 1, approvedHalfDays: 1 });
    expect(r.lines.find((l) => l.code === "HALF_DAY")!.amount).toBe(1371);
    const all = calculatePay({ ...base, days: octoberDays({ 5: "HALF_DAY" }), approvedHalfDayDates: new Set(["2026-10-05"]) });
    expect(all.lines.some((l) => l.code === "HALF_DAY")).toBe(false);
    expect(all.netPay).toBe(85_000);
  });

  it("the half-day deduction counts in earned to date", () => {
    const r = calculatePay({ ...base, today: "2026-10-10", days: new Map([["2026-10-05", "HALF_DAY"]]) });
    const e = earnedToDate({ year: 2026, month: 10, today: "2026-10-10", joiningDate: "2024-01-01", exitDate: null, perDayRate: r.perDayRate, lines: r.lines })!;
    expect(e.amount).toBe(Math.round(10 * r.perDayRate - 1371));
  });

  it("payslip label", () => {
    expect(payslipLineLabel({ code: "HALF_DAY", label: "Half day 2 × 0.5 × 2741.94" })).toBe("Half Day Deduction (2 days)");
    expect(payslipLineLabel({ code: "HALF_DAY", label: "Half day 1 × 0.5 × 2741.94" })).toBe("Half Day Deduction (1 day)");
  });
});

describe("half-day request approval check", () => {
  it("has its own reason", () => {
    expect(waiverReasonText("HALF_DAY")).toBe("Half day (left early with permission)");
  });

  it("approves a half day, or an early day with at least 4.5 hours worked", () => {
    expect(checkHalfDay({ status: "HALF_DAY", workedMinutes: 300 })).toEqual({ ok: true, workedMinutes: 300 });
    expect(checkHalfDay({ status: "EARLY", workedMinutes: 270 }).ok).toBe(true);
  });

  it("blocks other days with a clear message", () => {
    const short = checkHalfDay({ status: "EARLY", workedMinutes: 200 });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.message).toMatch(/not a half day \(3:20 worked/);
    expect(checkHalfDay({ status: "PRESENT", workedMinutes: 540 }).ok).toBe(false);
    expect(checkHalfDay({ status: "MISSING", workedMinutes: null }).ok).toBe(false);
    expect(checkHalfDay(null).ok).toBe(false);
  });

  it("other reasons keep the late-waiver full-hours rule", () => {
    expect(checkRequest("FULL_HOURS", { status: "HALF_DAY", workedMinutes: 300 }, 540).ok).toBe(false);
    expect(checkRequest("FULL_HOURS", { status: "LATE", workedMinutes: 540 }, 540).ok).toBe(true);
    expect(checkRequest("HALF_DAY", { status: "HALF_DAY", workedMinutes: 300 }, 540).ok).toBe(true);
  });

  it("half-day requests count towards the monthly limit", () => {
    const reqs = ["01", "02", "05", "06", "07"].map((d, i) => ({ workDate: `2026-10-${d}`, status: i % 2 ? "APPROVED" : "PENDING" }));
    expect(waiverRequestsLeft(reqs, "2026-10")).toBe(0);
  });
});

describe("attendance summary half days", () => {
  const { from, to } = monthRange(2026, 10);
  const day = (d: number, status: AttendanceStatusCode) => ({ workDate: `2026-10-${String(d).padStart(2, "0")}`, status, workedMinutes: 300, lateMinutes: 0 });

  it("counts half days and adds 0.5 per unapproved half day to the total deduction days", () => {
    const s = summariseAttendance([day(1, "HALF_DAY"), day(2, "HALF_DAY"), day(5, "HALF_DAY"), day(6, "ABSENT")], from, to, new Set(["2026-10-02"]));
    expect(s).toMatchObject({ halfDay: 3, halfOrShort: 3, halfDayDeductionDays: 1, absent: 1, totalDeductionDays: 2, present: 3 });
  });
});
