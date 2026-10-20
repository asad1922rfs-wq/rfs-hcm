// Loan (salary advance) deductions. Pure: no I/O, deterministic.
//
// Confirmed RFS rules:
//   * Interest-free. Each payroll month deducts the installment HR entered for that month; an entry of 0 skips the
//     month. A month without an entry repeats the latest earlier entry above 0 (earlier skips do not reset it); with
//     no earlier entry nothing is deducted.
//   * An entry never deducts more than the outstanding balance. A cash repayment lowers the balance.
//   * Loan deductions never make net pay negative: what does not fit stays outstanding.
//   * The balance counts RECORDED repayments only. Payroll repayments are recorded when the run is approved, so
//     recalculating a draft never counts its own deduction twice.

export type LoanStatusCode = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";

export type LoanTerms = { amount: number; status: LoanStatusCode };

export type RepaymentRecord = { amount: number; source: "PAYROLL" | "CASH"; year: number; month: number };
/** The installment HR entered for one month: more than 0 is deducted, 0 skips the month, null counts as no entry. */
export type MonthOverride = { year: number; month: number; amount: number | null };

/** One loan's deduction for a payroll month, before the net-pay cap. */
export type LoanDue = { loanId: string; amount: number };

export const MAX_LOAN_AMOUNT = 10_000_000;

/** Months since year 0, so months compare and subtract as plain numbers. */
export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
export const fromMonthIndex = (index: number) => ({ year: Math.floor(index / 12), month: (index % 12) + 1 });
export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export function outstandingBalance(amount: number, repayments: readonly Pick<RepaymentRecord, "amount">[]): number {
  return Math.max(0, Math.round(amount) - repayments.reduce((s, r) => s + Math.round(r.amount), 0));
}

/** The amount HR entered for a month (0 = skip), or null when the month has no entry. */
export function enteredFor(overrides: readonly MonthOverride[], year: number, month: number): number | null {
  const o = overrides.find((x) => x.year === year && x.month === month);
  return o && o.amount !== null ? Math.max(0, Math.round(o.amount)) : null;
}

export type EffectiveAmount = { amount: number; entered: number | null; repeatsFrom: { year: number; month: number } | null };

/**
 * What a month asks to deduct before any cap: its own entry (0 = skip); otherwise the latest earlier entry above 0
 * (an earlier skip does not reset it); otherwise 0.
 */
export function effectiveFor(overrides: readonly MonthOverride[], year: number, month: number): EffectiveAmount {
  const entered = enteredFor(overrides, year, month);
  if (entered !== null) return { amount: entered, entered, repeatsFrom: null };
  const target = monthIndex(year, month);
  let best: { year: number; month: number; amount: number } | null = null;
  for (const o of overrides) {
    if (o.amount === null || Math.round(o.amount) <= 0) continue;
    const i = monthIndex(o.year, o.month);
    if (i < target && (!best || i > monthIndex(best.year, best.month))) best = { year: o.year, month: o.month, amount: Math.round(o.amount) };
  }
  return best ? { amount: best.amount, entered: null, repeatsFrom: { year: best.year, month: best.month } } : { amount: 0, entered: null, repeatsFrom: null };
}

/**
 * The installment a loan deducts in a payroll month, or null when nothing is due: the loan is not approved, the
 * effective amount (see effectiveFor) is 0, or it is fully repaid. Capped at the outstanding balance.
 * A payroll repayment already recorded for this very month (an approved run) is ignored, so the answer is stable.
 */
export function loanDueFor(
  loanId: string,
  loan: LoanTerms,
  repayments: readonly RepaymentRecord[],
  overrides: readonly MonthOverride[],
  year: number,
  month: number,
): LoanDue | null {
  if (loan.status !== "APPROVED") return null;
  const entered = effectiveFor(overrides, year, month).amount;
  if (entered <= 0) return null;
  const target = monthIndex(year, month);
  const counted = repayments.filter((r) => !(r.source === "PAYROLL" && monthIndex(r.year, r.month) === target));
  const balance = outstandingBalance(loan.amount, counted);
  if (balance <= 0) return null;
  return { loanId, amount: Math.min(entered, balance) };
}

/**
 * Fit several loans' installments into what is left of net pay after every other deduction. Older loans (earlier
 * in the list) are served first; anything that does not fit stays outstanding. Zero-amount results are dropped.
 */
export function capLoanDeductions(dues: readonly LoanDue[], available: number): { deductions: (LoanDue & { requested: number })[]; shortfall: number } {
  let left = Math.max(0, Math.floor(available));
  let shortfall = 0;
  const deductions: (LoanDue & { requested: number })[] = [];
  for (const due of dues) {
    const amount = Math.min(due.amount, left);
    shortfall += due.amount - amount;
    left -= amount;
    if (amount > 0) deductions.push({ ...due, amount, requested: due.amount });
  }
  return { deductions, shortfall };
}

export const loanLineLabel = (d: LoanDue & { requested?: number }) =>
  `Loan repayment${d.requested !== undefined && d.amount < d.requested ? " — reduced to keep net pay above zero" : ""}`;

// ───────────── Month-by-month list ─────────────

export type LoanMonthRow = {
  year: number;
  month: number;
  key: string;
  /** Payroll month that can still be changed (open payroll, not already deducted) */
  open: boolean;
  /** Installment HR entered for the month (0 = skip, null = no entry) */
  entered: number | null;
  /** What an open month would deduct (before the net-pay cap): its entry or the repeated amount, capped at the projected balance */
  effective: number;
  /** For an open month without an entry that repeats an earlier one: that month's key */
  repeatsFrom: string | null;
  /** Deducted through payroll in this month */
  payroll: number;
  /** Cash repaid in this month */
  cash: number;
};

/**
 * Past months with their actual repayments, then the open months HR can enter an installment for: the first open
 * payroll month and the `ahead` months after it, plus any later month that already has an entry. Open months are
 * listed only while the loan is running.
 */
export function buildMonthList(
  loan: LoanTerms,
  repayments: readonly RepaymentRecord[],
  overrides: readonly MonthOverride[],
  firstOpen: { year: number; month: number },
  ahead = 6,
): LoanMonthRow[] {
  const open = monthIndex(firstOpen.year, firstOpen.month);
  const months = new Map<number, LoanMonthRow>();
  const row = (i: number) => {
    let r = months.get(i);
    if (!r) {
      const { year, month } = fromMonthIndex(i);
      r = { year, month, key: monthKey(year, month), open: false, entered: null, effective: 0, repeatsFrom: null, payroll: 0, cash: 0 };
      months.set(i, r);
    }
    return r;
  };
  for (const r of repayments) {
    const m = row(monthIndex(r.year, r.month));
    if (r.source === "PAYROLL") m.payroll += Math.round(r.amount);
    else m.cash += Math.round(r.amount);
  }
  const running = loan.status === "APPROVED" && outstandingBalance(loan.amount, repayments) > 0;
  for (const o of overrides) {
    const i = monthIndex(o.year, o.month);
    if (i < open && !months.has(i)) continue; // an old entry for a closed month that deducted nothing
    if (i >= open && !running) continue;
    row(i).entered = enteredFor(overrides, o.year, o.month);
  }
  if (running) for (let i = open; i <= open + ahead; i++) row(i);
  for (const [i, r] of months) r.open = running && i >= open && r.payroll === 0;
  const sorted = [...months.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  // Project the open months in order: each takes its effective amount out of what is left.
  let left = outstandingBalance(loan.amount, repayments);
  for (const r of sorted) {
    if (!r.open) continue;
    const e = effectiveFor(overrides, r.year, r.month);
    r.repeatsFrom = e.repeatsFrom ? monthKey(e.repeatsFrom.year, e.repeatsFrom.month) : null;
    r.effective = Math.min(e.amount, left);
    left -= r.effective;
  }
  return sorted;
}
