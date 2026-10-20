import { describe, expect, it } from "vitest";
import {
  buildMonthList, capLoanDeductions, loanDueFor, loanLineLabel, outstandingBalance,
  type LoanTerms, type MonthOverride, type RepaymentRecord,
} from "@/core/loans/schedule";
import { calculatePay, type AttendanceStatusCode, type PayInput } from "@/core/payroll/calculate";

const loan: LoanTerms = { amount: 100_000, status: "APPROVED" };
const payroll = (year: number, month: number, amount: number): RepaymentRecord => ({ amount, source: "PAYROLL", year, month });
const cash = (year: number, month: number, amount: number): RepaymentRecord => ({ amount, source: "CASH", year, month });
const due = (repayments: RepaymentRecord[], year: number, month: number, overrides: MonthOverride[] = [], terms = loan) =>
  loanDueFor("L1", terms, repayments, overrides, year, month);
const set = (year: number, month: number, amount: number | null): MonthOverride => ({ year, month, amount });

describe("outstandingBalance", () => {
  it("is the amount less every recorded repayment, never below zero", () => {
    expect(outstandingBalance(100_000, [payroll(2026, 10, 16_667), cash(2026, 11, 20_000)])).toBe(63_333);
    expect(outstandingBalance(100, [cash(2026, 11, 150)])).toBe(0);
  });
});

describe("loanDueFor (manual installments)", () => {
  it("deducts nothing in a month without an entry", () => {
    expect(due([], 2026, 10)).toBeNull();
    expect(due([], 2026, 10, [set(2026, 11, 5_000)])).toBeNull();
  });

  it("deducts exactly the amount entered for the month", () => {
    expect(due([], 2026, 10, [set(2026, 10, 12_000)])).toEqual({ loanId: "L1", amount: 12_000 });
  });

  it("an explicit 0 skips the month; a null amount counts as no entry", () => {
    expect(due([], 2026, 10, [set(2026, 10, 0)])).toBeNull();
    expect(due([], 2026, 10, [set(2026, 10, null)])).toBeNull();
    expect(due([], 2026, 11, [set(2026, 10, 7_000), set(2026, 11, 0)])).toBeNull();
    expect(due([], 2026, 11, [set(2026, 10, 7_000), set(2026, 11, null)])).toMatchObject({ amount: 7_000 });
  });

  it("a month without an entry repeats the latest earlier entry above 0", () => {
    const o = [set(2026, 8, 3_000), set(2026, 10, 10_000)];
    expect(due([], 2026, 9, o)).toMatchObject({ amount: 3_000 });
    expect(due([], 2026, 11, o)).toMatchObject({ amount: 10_000 });
    expect(due([], 2027, 6, o)).toMatchObject({ amount: 10_000 });
  });

  it("a skip does not reset the repeat amount", () => {
    const o = [set(2026, 10, 10_000), set(2026, 11, 0)];
    expect(due([], 2026, 11, o)).toBeNull();
    expect(due([], 2026, 12, o)).toMatchObject({ amount: 10_000 });
  });

  it("with no entry ever, nothing is deducted", () => {
    expect(due([], 2026, 10, [])).toBeNull();
    expect(due([], 2026, 12, [set(2026, 11, 0)])).toBeNull();
  });

  it("clearing an entry falls back to repeating the earlier amount", () => {
    const withEntry = [set(2026, 10, 10_000), set(2026, 11, 4_000)];
    expect(due([], 2026, 11, withEntry)).toMatchObject({ amount: 4_000 });
    const cleared = withEntry.filter((o) => o.month !== 11);
    expect(due([], 2026, 11, cleared)).toMatchObject({ amount: 10_000 });
  });

  it("a repeated amount is capped at the balance: final partial month, then the loan completes", () => {
    const o = [set(2026, 10, 40_000)];
    const paid: RepaymentRecord[] = [];
    const amounts: number[] = [];
    for (let m = 10; m <= 13; m++) {
      const y = 2026 + Math.floor((m - 1) / 12), mm = ((m - 1) % 12) + 1;
      const d = due(paid, y, mm, o);
      if (!d) break;
      amounts.push(d.amount);
      paid.push(payroll(y, mm, d.amount));
    }
    expect(amounts).toEqual([40_000, 40_000, 20_000]);
    expect(outstandingBalance(loan.amount, paid)).toBe(0);
    expect(due(paid, 2027, 1, o)).toBeNull();
  });

  it("caps the entry at the outstanding balance", () => {
    expect(due([cash(2026, 9, 90_000)], 2026, 10, [set(2026, 10, 50_000)])).toEqual({ loanId: "L1", amount: 10_000 });
  });

  it("deducts nothing once the loan is fully repaid", () => {
    expect(due([payroll(2026, 9, 60_000), cash(2026, 9, 40_000)], 2026, 10, [set(2026, 10, 5_000)])).toBeNull();
  });

  it("deducts nothing for pending, rejected, completed or cancelled loans", () => {
    for (const status of ["PENDING", "REJECTED", "COMPLETED", "CANCELLED"] as const) {
      expect(due([], 2026, 10, [set(2026, 10, 5_000)], { ...loan, status })).toBeNull();
    }
  });

  it("ignores a payroll repayment already recorded for the same month (recalculating never double counts)", () => {
    const o = [set(2026, 10, 100_000)];
    expect(due([payroll(2026, 10, 100_000)], 2026, 10, o)).toEqual(due([], 2026, 10, o));
  });

  it("the entry that clears the balance completes the loan", () => {
    const o = [set(2026, 10, 70_000), set(2026, 11, 30_000)];
    expect(due([], 2026, 10, o)).toMatchObject({ amount: 70_000 });
    const after = [payroll(2026, 10, 70_000)];
    expect(due(after, 2026, 11, o)).toMatchObject({ amount: 30_000 });
    expect(outstandingBalance(loan.amount, [...after, payroll(2026, 11, 30_000)])).toBe(0);
  });
});

describe("capLoanDeductions", () => {
  const dues = [{ loanId: "A", amount: 10_000 }, { loanId: "B", amount: 5_000 }];

  it("keeps every entered installment when net pay covers them", () => {
    expect(capLoanDeductions(dues, 50_000)).toMatchObject({ shortfall: 0, deductions: [{ loanId: "A", amount: 10_000 }, { loanId: "B", amount: 5_000 }] });
  });

  it("caps at net pay: older loans first, the rest stays outstanding", () => {
    const r = capLoanDeductions(dues, 12_000);
    expect(r.deductions).toMatchObject([{ loanId: "A", amount: 10_000 }, { loanId: "B", amount: 2_000, requested: 5_000 }]);
    expect(r.shortfall).toBe(3_000);
    expect(capLoanDeductions(dues, 0)).toEqual({ deductions: [], shortfall: 15_000 });
    expect(capLoanDeductions(dues, -500).shortfall).toBe(15_000);
  });

  it("labels the line and says when it was reduced", () => {
    expect(loanLineLabel(dues[0]!)).toBe("Loan repayment");
    expect(loanLineLabel({ ...dues[1]!, amount: 2_000, requested: 5_000 })).toMatch(/reduced/);
  });
});

describe("buildMonthList", () => {
  const open = { year: 2026, month: 11 };

  it("lists past repayments, then the first open month and the six after it", () => {
    const rows = buildMonthList(loan, [payroll(2026, 10, 10_000), cash(2026, 10, 5_000)], [set(2026, 10, 10_000)], open);
    expect(rows[0]).toMatchObject({ key: "2026-10", open: false, payroll: 10_000, cash: 5_000, entered: 10_000 });
    expect(rows.slice(1).map((r) => [r.key, r.open])).toEqual([
      ["2026-11", true], ["2026-12", true], ["2027-01", true], ["2027-02", true], ["2027-03", true], ["2027-04", true], ["2027-05", true],
    ]);
  });

  it("shows entered amounts and adds later months that have an entry", () => {
    const rows = buildMonthList(loan, [], [set(2026, 12, 8_000), set(2027, 9, 3_000)], open);
    expect(rows.find((r) => r.key === "2026-12")).toMatchObject({ entered: 8_000, open: true });
    expect(rows.at(-1)).toMatchObject({ key: "2027-09", entered: 3_000, open: true });
  });

  it("shows the repeated default, skips and the projected final partial month", () => {
    const rows = buildMonthList(loan, [], [set(2026, 10, 30_000), set(2026, 12, 0)], open);
    const by = (k: string) => rows.find((r) => r.key === k);
    expect(by("2026-11")).toMatchObject({ entered: null, effective: 30_000, repeatsFrom: "2026-10" });
    expect(by("2026-12")).toMatchObject({ entered: 0, effective: 0, repeatsFrom: null });
    expect(by("2027-01")).toMatchObject({ effective: 30_000, repeatsFrom: "2026-10" });
    expect(by("2027-03")).toMatchObject({ effective: 10_000 });
    expect(by("2027-04")).toMatchObject({ effective: 0 });
  });

  it("skips old entries for closed months that deducted nothing", () => {
    expect(buildMonthList(loan, [], [set(2026, 9, 8_000)], open).some((r) => r.key === "2026-09")).toBe(false);
  });

  it("lists no open months once the loan is completed or cancelled", () => {
    const paid = [payroll(2026, 10, 100_000)];
    expect(buildMonthList({ ...loan, status: "COMPLETED" }, paid, [set(2026, 12, 1)], open).map((r) => r.key)).toEqual(["2026-10"]);
    expect(buildMonthList({ ...loan, status: "CANCELLED" }, [], [], open)).toEqual([]);
  });
});

describe("payroll with loans", () => {
  const october = () => {
    const m = new Map<string, AttendanceStatusCode>();
    for (let d = 1; d <= 31; d++) {
      const date = `2026-10-${String(d).padStart(2, "0")}`;
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (wd !== 0 && wd !== 6) m.set(date, "PRESENT");
    }
    return m;
  };
  const base: PayInput = {
    year: 2026, month: 10, today: "2026-11-05", joiningDate: "2024-01-01", exitDate: null, weekendDays: [0, 6],
    salary: { basic: 60_000, allowances: [] }, days: october(), adjustments: [],
  };

  it("adds one LOAN deduction line per loan", () => {
    const r = calculatePay({
      ...base,
      loans: [
        { loanId: "A", amount: 10_000 },
        { loanId: "B", amount: 5_000 },
      ],
    });
    const lines = r.lines.filter((l) => l.code === "LOAN");
    expect(lines).toEqual([
      { kind: "DEDUCTION", code: "LOAN", label: "Loan repayment", amount: 10_000, loanId: "A", planned: 10_000 },
      { kind: "DEDUCTION", code: "LOAN", label: "Loan repayment", amount: 5_000, loanId: "B", planned: 5_000 },
    ]);
    expect(r.netPay).toBe(45_000);
    expect(r.warnings).toEqual([]);
  });

  it("caps loan deductions at net pay after other deductions", () => {
    const r = calculatePay({
      ...base,
      adjustments: [{ kind: "DEDUCTION", label: "Damage recovery", amount: 55_000 }],
      loans: [{ loanId: "A", amount: 10_000 }],
    });
    expect(r.lines.find((l) => l.code === "LOAN")).toMatchObject({ amount: 5_000, planned: 10_000 });
    expect(r.netPay).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/reduced by 5000/);
  });

  it("drops the loan line entirely when nothing is left", () => {
    const r = calculatePay({ ...base, salary: null, loans: [{ loanId: "A", amount: 10_000 }] });
    expect(r.lines.some((l) => l.code === "LOAN")).toBe(false);
    expect(r.netPay).toBe(0);
  });
});
