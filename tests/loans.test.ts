import { describe, expect, it } from "vitest";
import {
  buildSchedule, capLoanDeductions, installmentPlan, installmentsLeft, loanDueFor, loanLineLabel, outstandingBalance, splitInstallments,
  type LoanTerms, type PauseRecord, type RepaymentRecord,
} from "@/core/loans/schedule";
import { calculatePay, type AttendanceStatusCode, type PayInput } from "@/core/payroll/calculate";

// 100,000 over 6 months from October 2026: 16,667 × 5 + 16,665.
const loan: LoanTerms = { amount: 100_000, installments: 6, startYear: 2026, startMonth: 10, status: "APPROVED" };
const payroll = (year: number, month: number, amount: number): RepaymentRecord => ({ amount, source: "PAYROLL", year, month });
const cash = (year: number, month: number, amount: number): RepaymentRecord => ({ amount, source: "CASH", year, month });
const due = (repayments: RepaymentRecord[], year: number, month: number, pauses: PauseRecord[] = [], terms = loan) =>
  loanDueFor("L1", terms, repayments, pauses, year, month);

describe("installment split", () => {
  it("rounds to whole rupees and the last installment takes the remainder", () => {
    expect(splitInstallments(100_000, 6)).toEqual([16_667, 16_667, 16_667, 16_667, 16_667, 16_665]);
    expect(splitInstallments(100_000, 3)).toEqual([33_333, 33_333, 33_334]);
    expect(splitInstallments(50_000, 1)).toEqual([50_000]);
    for (const [amount, n] of [[100_000, 6], [99_999, 7], [10, 6], [7, 7], [1_234_567, 60]] as const) {
      const parts = splitInstallments(amount, n);
      expect(parts).toHaveLength(n);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(amount);
      expect(Math.min(...parts)).toBeGreaterThan(0);
    }
  });

  it("rounds down instead when rounding up would leave nothing for the last installment", () => {
    expect(installmentPlan(10, 6)).toEqual({ regular: 1, last: 5 });
  });

  it("counts installments left for a balance", () => {
    const plan = installmentPlan(100_000, 6);
    expect(installmentsLeft(100_000, plan)).toBe(6);
    expect(installmentsLeft(16_665, plan)).toBe(1);
    expect(installmentsLeft(0, plan)).toBe(0);
    expect(installmentsLeft(9, installmentPlan(10, 6))).toBe(5);
  });

  it("outstanding balance is the amount less every recorded repayment", () => {
    expect(outstandingBalance(100_000, [payroll(2026, 10, 16_667), cash(2026, 11, 20_000)])).toBe(63_333);
    expect(outstandingBalance(100, [cash(2026, 11, 150)])).toBe(0);
  });
});

describe("loanDueFor", () => {
  it("deducts the first installment in the start month, numbered 1 of 6", () => {
    expect(due([], 2026, 10)).toEqual({ loanId: "L1", amount: 16_667, installmentNo: 1, totalInstallments: 6 });
  });

  it("deducts nothing before the start month", () => {
    expect(due([], 2026, 9)).toBeNull();
    expect(due([], 2025, 12)).toBeNull();
  });

  it("deducts nothing for pending, rejected, completed or cancelled loans", () => {
    for (const status of ["PENDING", "REJECTED", "COMPLETED", "CANCELLED"] as const) {
      expect(due([], 2026, 10, [], { ...loan, status })).toBeNull();
    }
  });

  it("numbers installments from the payroll repayments already recorded", () => {
    const paid = [payroll(2026, 10, 16_667), payroll(2026, 11, 16_667)];
    expect(due(paid, 2026, 12)).toMatchObject({ amount: 16_667, installmentNo: 3, totalInstallments: 6 });
  });

  it("the last installment takes the remainder and then the loan is done", () => {
    const five = [10, 11, 12].map((m) => payroll(2026, m, 16_667)).concat([1, 2].map((m) => payroll(2027, m, 16_667)));
    expect(due(five, 2027, 3)).toMatchObject({ amount: 16_665, installmentNo: 6, totalInstallments: 6 });
    expect(due([...five, payroll(2027, 3, 16_665)], 2027, 4)).toBeNull();
  });

  it("ignores a payroll repayment already recorded for the same month (recalculating never double counts)", () => {
    const paid = [payroll(2026, 10, 16_667)];
    expect(due(paid, 2026, 10)).toEqual(due([], 2026, 10));
  });

  it("a paused month deducts nothing and the next month takes the same installment", () => {
    const pauses = [{ year: 2026, month: 11 }];
    const paid = [payroll(2026, 10, 16_667)];
    expect(due(paid, 2026, 11, pauses)).toBeNull();
    expect(due(paid, 2026, 12, pauses)).toMatchObject({ amount: 16_667, installmentNo: 2, totalInstallments: 6 });
  });

  it("a cash repayment lowers the balance so later deductions finish sooner", () => {
    const paid = [payroll(2026, 10, 16_667), payroll(2026, 11, 16_667), cash(2026, 11, 50_000)];
    // 16,666 left: one final installment
    expect(due(paid, 2026, 12)).toEqual({ loanId: "L1", amount: 16_666, installmentNo: 3, totalInstallments: 3 });
    const smaller = [payroll(2026, 10, 16_667), cash(2026, 10, 80_000)];
    expect(due(smaller, 2026, 11)).toMatchObject({ amount: 3_333, totalInstallments: 2 });
  });

  it("never deducts more than the outstanding balance", () => {
    expect(due([cash(2026, 10, 99_000)], 2026, 10)).toMatchObject({ amount: 1_000 });
    expect(due([cash(2026, 10, 100_000)], 2026, 10)).toBeNull();
  });

  it("a shortfall in one month extends the schedule", () => {
    const short = [payroll(2026, 10, 6_667)]; // only 6,667 fitted in October
    expect(due(short, 2026, 11)).toMatchObject({ amount: 16_667, installmentNo: 2, totalInstallments: 7 });
  });
});

describe("capLoanDeductions", () => {
  const dues = [
    { loanId: "A", amount: 10_000, installmentNo: 1, totalInstallments: 5 },
    { loanId: "B", amount: 5_000, installmentNo: 2, totalInstallments: 4 },
  ];

  it("keeps every installment when net pay covers them", () => {
    expect(capLoanDeductions(dues, 50_000)).toMatchObject({ shortfall: 0, deductions: [{ loanId: "A", amount: 10_000 }, { loanId: "B", amount: 5_000 }] });
  });

  it("serves older loans first and drops what does not fit", () => {
    const r = capLoanDeductions(dues, 12_000);
    expect(r.deductions).toMatchObject([{ loanId: "A", amount: 10_000 }, { loanId: "B", amount: 2_000, requested: 5_000 }]);
    expect(r.shortfall).toBe(3_000);
    expect(capLoanDeductions(dues, 0)).toEqual({ deductions: [], shortfall: 15_000 });
    expect(capLoanDeductions(dues, -500).shortfall).toBe(15_000);
  });

  it("labels the line and says when it was reduced", () => {
    expect(loanLineLabel(dues[0]!)).toBe("Loan repayment (installment 1 of 5)");
    expect(loanLineLabel({ ...dues[1]!, amount: 2_000, requested: 5_000 })).toMatch(/reduced/);
  });
});

describe("buildSchedule", () => {
  it("projects every installment of a fresh loan", () => {
    const rows = buildSchedule(loan, [], [], new Set());
    expect(rows.map((r) => [r.key, r.status, r.amount, r.installmentNo])).toEqual([
      ["2026-10", "UPCOMING", 16_667, 1], ["2026-11", "UPCOMING", 16_667, 2], ["2026-12", "UPCOMING", 16_667, 3],
      ["2027-01", "UPCOMING", 16_667, 4], ["2027-02", "UPCOMING", 16_667, 5], ["2027-03", "UPCOMING", 16_665, 6],
    ]);
    expect(rows.at(-1)!.balanceAfter).toBe(0);
  });

  it("shows paid, paused and missed months and extends past them", () => {
    const rows = buildSchedule(loan, [payroll(2026, 10, 16_667), cash(2026, 12, 10_000)], [{ year: 2026, month: 11 }], new Set(["2026-10", "2026-11"]));
    expect(rows.slice(0, 3).map((r) => [r.key, r.status, r.amount, r.cash])).toEqual([
      ["2026-10", "PAID", 16_667, 0], ["2026-11", "PAUSED", 0, 0], ["2026-12", "UPCOMING", 16_667, 10_000],
    ]);
    expect(rows.reduce((s, r) => s + r.amount + r.cash, 0)).toBe(100_000);
    expect(rows.at(-1)!.balanceAfter).toBe(0);
  });

  it("marks a closed month with no repayment as not deducted", () => {
    const rows = buildSchedule(loan, [], [], new Set(["2026-10"]));
    expect(rows[0]).toMatchObject({ key: "2026-10", status: "NOT_DEDUCTED", amount: 0 });
    expect(rows.filter((r) => r.status === "UPCOMING")).toHaveLength(6);
  });

  it("does not project a cancelled loan", () => {
    const rows = buildSchedule({ ...loan, status: "CANCELLED" }, [payroll(2026, 10, 16_667)], [], new Set(["2026-10"]));
    expect(rows.map((r) => r.status)).toEqual(["PAID"]);
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
        { loanId: "A", amount: 10_000, installmentNo: 3, totalInstallments: 6 },
        { loanId: "B", amount: 5_000, installmentNo: 1, totalInstallments: 2 },
      ],
    });
    const lines = r.lines.filter((l) => l.code === "LOAN");
    expect(lines).toEqual([
      { kind: "DEDUCTION", code: "LOAN", label: "Loan repayment (installment 3 of 6)", amount: 10_000, loanId: "A" },
      { kind: "DEDUCTION", code: "LOAN", label: "Loan repayment (installment 1 of 2)", amount: 5_000, loanId: "B" },
    ]);
    expect(r.netPay).toBe(45_000);
    expect(r.warnings).toEqual([]);
  });

  it("caps loan deductions at net pay after other deductions", () => {
    const r = calculatePay({
      ...base,
      adjustments: [{ kind: "DEDUCTION", label: "Damage recovery", amount: 55_000 }],
      loans: [{ loanId: "A", amount: 10_000, installmentNo: 1, totalInstallments: 6 }],
    });
    expect(r.lines.find((l) => l.code === "LOAN")!.amount).toBe(5_000);
    expect(r.netPay).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/reduced by 5000/);
  });

  it("drops the loan line entirely when nothing is left", () => {
    const r = calculatePay({ ...base, salary: null, loans: [{ loanId: "A", amount: 10_000, installmentNo: 1, totalInstallments: 6 }] });
    expect(r.lines.some((l) => l.code === "LOAN")).toBe(false);
    expect(r.netPay).toBe(0);
  });
});
