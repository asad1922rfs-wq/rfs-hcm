import { describe, expect, it } from "vitest";
import { calculatePay, type AttendanceStatusCode, type PayInput } from "@/core/payroll/calculate";

// October 2026: 31 days, 1 Oct is a Thursday. Weekends Sat/Sun.
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

describe("calculatePay", () => {
  it("full month with perfect attendance pays the full gross", () => {
    const r = calculatePay(base);
    expect(r).toMatchObject({ daysInMonth: 31, gross: 85_000, perDayRate: 2741.94, netPay: 85_000, deductions: 0, warnings: [] });
    expect(r.lines.map((l) => l.code)).toEqual(["BASIC", "ALLOWANCE"]);
  });

  it("deducts one day per absence at gross ÷ days in month", () => {
    const r = calculatePay({ ...base, days: octoberDays({ 5: "ABSENT", 6: "ABSENT" }) });
    expect(r.absentDays).toBe(2);
    expect(r.lines.find((l) => l.code === "ABSENT")!.amount).toBe(5484); // 2 × 2741.94
    expect(r.netPay).toBe(85_000 - 5484);
  });

  it("every 3 late arrivals or missing punches = 1 day; remainders are not deducted", () => {
    const two = calculatePay({ ...base, days: octoberDays({ 1: "LATE", 2: "MISSING" }) });
    expect(two.lateDeductionDays).toBe(0);
    const five = calculatePay({ ...base, days: octoberDays({ 1: "LATE", 2: "LATE", 5: "MISSING", 6: "LATE", 7: "MISSING" }) });
    expect(five).toMatchObject({ lateCount: 3, missingPunchCount: 2, lateDeductionDays: 1 });
    const late = five.lines.find((l) => l.code === "LATE")!;
    expect(late.amount).toBe(2742);
    expect(late.label).toMatch(/3 late arrivals \+ 2 missing punches → 1 day/);
  });

  it("prorates a mid-month joiner by calendar days employed", () => {
    const r = calculatePay({ ...base, joiningDate: "2026-10-22" }); // employed 22–31 = 10 days
    expect(r.employedDays).toBe(10);
    expect(r.lines.find((l) => l.code === "PRORATION")!.amount).toBe(Math.round(21 * 2741.94));
    expect(r.netPay).toBe(85_000 - Math.round(21 * 2741.94));
  });

  it("prorates a leaver and ignores attendance after the exit date", () => {
    const r = calculatePay({ ...base, exitDate: "2026-10-09", days: octoberDays({ 20: "ABSENT" }) });
    expect(r.employedDays).toBe(9);
    expect(r.absentDays).toBe(0);
  });

  it("does not deduct days without machine data, but warns", () => {
    const days = octoberDays();
    days.delete("2026-10-14");
    days.delete("2026-10-15");
    const r = calculatePay({ ...base, days });
    expect(r.notSyncedDays).toBe(2);
    expect(r.netPay).toBe(85_000);
    expect(r.warnings.join()).toMatch(/2 working days without machine attendance/);
  });

  it("counts remaining days of an unfinished month as paid, with a warning", () => {
    const days = new Map([...octoberDays()].filter(([d]) => d < "2026-10-16"));
    const r = calculatePay({ ...base, today: "2026-10-16", days });
    expect(r.remainingDays).toBe(16);
    expect(r.notSyncedDays).toBe(0);
    expect(r.netPay).toBe(85_000);
    expect(r.warnings.join()).toMatch(/Month not finished/);
  });

  it("adds manual earnings and deductions, and never pays below zero", () => {
    const r = calculatePay({ ...base, adjustments: [{ kind: "EARNING", label: "Performance bonus", amount: 10_000 }, { kind: "DEDUCTION", label: "Salary advance recovery", amount: 15_000 }] });
    expect(r.netPay).toBe(80_000);
    const neg = calculatePay({ ...base, adjustments: [{ kind: "DEDUCTION", label: "Advance", amount: 100_000 }] });
    expect(neg.netPay).toBe(0);
    expect(neg.warnings.join()).toMatch(/exceed earnings/);
  });

  it("pays nothing without a salary, and says why", () => {
    const r = calculatePay({ ...base, salary: null });
    expect(r.netPay).toBe(0);
    expect(r.warnings[0]).toMatch(/No salary/);
  });
});
