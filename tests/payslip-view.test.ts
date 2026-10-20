import { describe, expect, it } from "vitest";
import { calculatePay, type AttendanceStatusCode, type PayInput } from "@/core/payroll/calculate";
import { earnedToDate } from "@/core/payroll/earned-to-date";
import { payslipLineLabel } from "@/core/payroll/payslip-labels";

// October 2026: 31 days, weekend Sat/Sun. 100,000 / 31 = 3225.81 per day.
const base: PayInput = {
  year: 2026,
  month: 10,
  today: "2026-10-19",
  joiningDate: "2024-01-01",
  exitDate: null,
  weekendDays: [0, 6],
  salary: { basic: 100_000, allowances: [] },
  days: new Map(),
  adjustments: [],
};

describe("earnedToDate", () => {
  it("is per-day rate × elapsed days, less attendance deductions so far", () => {
    const days = new Map<string, AttendanceStatusCode>([["2026-10-05", "ABSENT"], ["2026-10-06", "LATE"], ["2026-10-07", "LATE"], ["2026-10-08", "MISSING"]]);
    const r = calculatePay({ ...base, days, adjustments: [{ kind: "DEDUCTION", label: "Advance", amount: 5000 }] });
    const e = earnedToDate({ ...base, perDayRate: r.perDayRate, lines: r.lines });
    // 19 days × 3225.81 = 61290.39, less absent 3226 and late 3226 (the manual adjustment waits for month end).
    expect(e).toEqual({ from: "2026-10-01", to: "2026-10-19", days: 19, amount: Math.round(19 * 3225.81 - 3226 - 3226) });
  });

  it("starts at the joining date and ignores the not-employed proration and loans", () => {
    const input = { ...base, joiningDate: "2026-10-10", loans: [{ loanId: "l1", amount: 10_000 }] };
    const r = calculatePay(input);
    expect(r.lines.some((l) => l.code === "PRORATION")).toBe(true);
    expect(r.lines.some((l) => l.code === "LOAN")).toBe(true);
    expect(earnedToDate({ ...input, perDayRate: r.perDayRate, lines: r.lines })).toEqual({ from: "2026-10-10", to: "2026-10-19", days: 10, amount: Math.round(10 * 3225.81) });
  });

  it("stops at the exit date, never goes below zero, and is null outside the month", () => {
    const lines = [{ kind: "DEDUCTION" as const, code: "ABSENT", label: "Absent", amount: 99_999 }];
    expect(earnedToDate({ ...base, exitDate: "2026-10-03", perDayRate: 1000, lines: [] })).toMatchObject({ to: "2026-10-03", days: 3, amount: 3000 });
    expect(earnedToDate({ ...base, perDayRate: 1000, lines })?.amount).toBe(0);
    expect(earnedToDate({ ...base, today: "2026-11-01", perDayRate: 1000, lines: [] })).toBeNull();
    expect(earnedToDate({ ...base, today: "2026-09-30", perDayRate: 1000, lines: [] })).toBeNull();
    expect(earnedToDate({ ...base, joiningDate: "2026-10-25", perDayRate: 1000, lines: [] })?.days).toBe(0);
  });
});

describe("payslipLineLabel", () => {
  it("turns engine lines into short payslip labels, keeping the day counts", () => {
    const days = new Map<string, AttendanceStatusCode>([
      ...["01", "02", "05", "06", "07", "08", "09", "12", "13", "14"].map((d) => [`2026-10-${d}`, "ABSENT"] as [string, AttendanceStatusCode]),
      ["2026-10-15", "LATE"], ["2026-10-16", "LATE"], ["2026-10-19", "MISSING"], ["2026-10-20", "LEAVE"], ["2026-10-21", "LEAVE"],
    ]);
    const r = calculatePay({
      ...base, today: "2026-11-01", joiningDate: "2026-10-01", days, unpaidLeaveDates: new Set(["2026-10-20", "2026-10-21"]),
      loans: [{ loanId: "l1", amount: 5000 }],
    });
    expect(r.lines.map(payslipLineLabel)).toEqual([
      "Basic Salary",
      "Absent Deduction (10.00 Absent Days)",
      "Unpaid Leave (2 days)",
      "Late / Missing Punch (1 day)",
      "Loan",
    ]);
  });

  it("labels proration and keeps other labels", () => {
    const r = calculatePay({ ...base, joiningDate: "2026-10-06", salary: { basic: 90_000, allowances: [{ name: "House", amount: 10_000 }] } });
    expect(r.lines.map(payslipLineLabel)).toEqual(["Basic Salary", "House allowance", "Not Employed (5 days, joined 2026-10-06)"]);
    expect(payslipLineLabel({ code: "ADJ_DEDUCTION", label: "Advance" })).toBe("Advance");
  });
});
