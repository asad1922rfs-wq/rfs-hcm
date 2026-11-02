import { describe, expect, it } from "vitest";
import { calculatePay, type AttendanceStatusCode, type PayInput } from "@/core/payroll/calculate";
import { payslipLineLabel } from "@/core/payroll/payslip-labels";
import { salaryRevisionBlock, salesMonthBlock } from "@/core/payroll/salary-revision";

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

describe("commission in payroll", () => {
  it("adds the month's commission as an earning after the allowances", () => {
    const r = calculatePay({ ...base, commission: 12_345.6 });
    expect(r.lines.map((l) => l.code)).toEqual(["BASIC", "ALLOWANCE", "COMMISSION"]);
    expect(r.lines[2]).toMatchObject({ kind: "EARNING", label: "Commission", amount: 12_346 });
    expect(r.earnings).toBe(97_346);
    expect(r.netPay).toBe(97_346);
  });

  it("does not change the per-day rate or day deductions (gross is salary only)", () => {
    const without = calculatePay({ ...base, days: octoberDays({ 5: "ABSENT" }) });
    const withC = calculatePay({ ...base, days: octoberDays({ 5: "ABSENT" }), commission: 10_000 });
    expect(withC.perDayRate).toBe(without.perDayRate);
    expect(withC.gross).toBe(85_000);
    expect(withC.netPay - without.netPay).toBe(10_000);
  });

  it("is not prorated for a joiner", () => {
    const r = calculatePay({ ...base, joiningDate: "2026-10-16", commission: 5_000 });
    expect(r.lines.find((l) => l.code === "COMMISSION")!.amount).toBe(5_000);
  });

  it("adds no line for zero or missing commission", () => {
    expect(calculatePay({ ...base, commission: 0 }).lines.some((l) => l.code === "COMMISSION")).toBe(false);
    expect(calculatePay(base).lines.some((l) => l.code === "COMMISSION")).toBe(false);
  });

  it("payslip shows it as Commission", () => {
    expect(payslipLineLabel({ code: "COMMISSION", label: "Commission" })).toBe("Commission");
  });
});

describe("salary revision edit / delete rules", () => {
  const locked = new Set(["2026-09"]);
  it("allows editing a revision in an open month", () => {
    expect(salaryRevisionBlock({ currentDate: "2026-10-01", newDate: "2026-10-15", otherDates: ["2026-01-01"], lockedMonths: locked })).toBeNull();
  });
  it("blocks editing or deleting a revision effective in a month with approved/paid payroll", () => {
    expect(salaryRevisionBlock({ currentDate: "2026-09-01", newDate: "2026-10-01", otherDates: [], lockedMonths: locked })).toMatch(/September 2026.*approved or paid/);
    expect(salaryRevisionBlock({ currentDate: "2026-09-10", newDate: null, otherDates: [], lockedMonths: locked })).toMatch(/deleted/);
  });
  it("blocks moving a revision into a locked month", () => {
    expect(salaryRevisionBlock({ currentDate: "2026-10-01", newDate: "2026-09-20", otherDates: [], lockedMonths: locked })).toMatch(/moved into/);
  });
  it("blocks moving onto another revision's date", () => {
    expect(salaryRevisionBlock({ currentDate: "2026-10-01", newDate: "2026-01-01", otherDates: ["2026-01-01"], lockedMonths: locked })).toMatch(/already starts/);
  });
  it("allows deleting the only revision", () => {
    expect(salaryRevisionBlock({ currentDate: "2026-10-01", newDate: null, otherDates: [], lockedMonths: locked })).toBeNull();
  });
  it("locks sales months with approved/paid payroll", () => {
    expect(salesMonthBlock("2026-09", locked)).toMatch(/September 2026/);
    expect(salesMonthBlock("2026-10", locked)).toBeNull();
  });
});
