import { describe, expect, it } from "vitest";
import { balanceOf, countLeaveDays, leaveDaysWithin } from "@/core/leave/days";
import { calculatePay, type AttendanceStatusCode } from "@/core/payroll/calculate";

const WEEKEND = [0, 6];

describe("leave days", () => {
  it("counts working days only (Fri 16 Oct – Mon 19 Oct 2026 = 2)", () => {
    expect(countLeaveDays("2026-10-16", "2026-10-19", WEEKEND)).toBe(2);
    expect(countLeaveDays("2026-10-17", "2026-10-18", WEEKEND)).toBe(0); // weekend only
    expect(countLeaveDays("2026-10-12", "2026-10-16", WEEKEND)).toBe(5);
  });

  it("splits a leave across a period boundary", () => {
    // 29 Dec 2026 (Tue) – 5 Jan 2027 (Tue): 4 days in 2026, 3 in 2027
    expect(leaveDaysWithin("2026-12-29", "2027-01-05", "2026-01-01", "2026-12-31", WEEKEND)).toBe(3);
    expect(leaveDaysWithin("2026-12-29", "2027-01-05", "2027-01-01", "2027-12-31", WEEKEND)).toBe(3);
  });

  it("computes balances; unlimited types have no remaining figure", () => {
    expect(balanceOf(14, 5, 2)).toEqual({ entitlement: 14, used: 5, pending: 2, remaining: 7 });
    expect(balanceOf(null, 3, 0).remaining).toBeNull();
  });
});

describe("payroll with leave", () => {
  const days = new Map<string, AttendanceStatusCode>();
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) days.set(date, "PRESENT");
  }
  days.set("2026-10-05", "LEAVE");
  days.set("2026-10-06", "LEAVE");
  const base = {
    year: 2026, month: 10, today: "2026-11-05", joiningDate: "2024-01-01", exitDate: null, weekendDays: WEEKEND,
    salary: { basic: 85_000, allowances: [] }, days, adjustments: [],
  };

  it("paid leave is not deducted", () => {
    const r = calculatePay(base);
    expect(r).toMatchObject({ paidLeaveDays: 2, unpaidLeaveDays: 0, netPay: 85_000 });
  });

  it("unpaid leave deducts one day each", () => {
    const r = calculatePay({ ...base, unpaidLeaveDates: new Set(["2026-10-06"]) });
    expect(r).toMatchObject({ paidLeaveDays: 1, unpaidLeaveDays: 1 });
    expect(r.lines.find((l) => l.code === "UNPAID_LEAVE")!.amount).toBe(2742);
  });
});

describe("leave days with public holidays", () => {
  // Mon 12 – Fri 16 Oct 2026 with Wed 14 Oct a holiday
  const HOLIDAYS = new Set(["2026-10-14"]);

  it("does not count a holiday inside the leave", () => {
    expect(countLeaveDays("2026-10-12", "2026-10-16", WEEKEND, HOLIDAYS)).toBe(4);
    expect(countLeaveDays("2026-10-14", "2026-10-14", WEEKEND, HOLIDAYS)).toBe(0);
    expect(leaveDaysWithin("2026-10-12", "2026-10-31", "2026-10-01", "2026-10-15", WEEKEND, HOLIDAYS)).toBe(3);
  });
});
