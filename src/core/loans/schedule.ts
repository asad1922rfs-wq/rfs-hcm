// Loan (salary advance) repayment schedule. Pure: no I/O, deterministic.
//
// Confirmed RFS rules:
//   * Interest-free. Installment = amount ÷ installments, rounded to whole rupees; the LAST installment takes the
//     remainder so the installments add up to the amount exactly.
//   * From the start month, each payroll deducts one installment (never more than the outstanding balance).
//   * A paused month deducts nothing; a cash repayment lowers the balance, so the schedule ends sooner.
//   * Loan deductions never make net pay negative: what does not fit stays outstanding and the schedule extends.
//   * The balance counts RECORDED repayments only. Payroll repayments are recorded when the run is approved, so
//     recalculating a draft never counts its own deduction twice.

export type LoanStatusCode = "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";

export type LoanTerms = {
  amount: number;
  installments: number;
  startYear: number;
  startMonth: number; // 1–12
  status: LoanStatusCode;
};

export type RepaymentRecord = { amount: number; source: "PAYROLL" | "CASH"; year: number; month: number };
export type PauseRecord = { year: number; month: number };

/** One loan's deduction for a payroll month, before the net-pay cap. */
export type LoanDue = { loanId: string; amount: number; installmentNo: number; totalInstallments: number };

export const MAX_LOAN_AMOUNT = 10_000_000;
export const MAX_INSTALLMENTS = 60;

/** Months since year 0, so months compare and subtract as plain numbers. */
export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
export const fromMonthIndex = (index: number) => ({ year: Math.floor(index / 12), month: (index % 12) + 1 });
export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * Regular installment and the last one. Rounded normally; for tiny amounts where rounding up would leave nothing
 * (or less than nothing) for the last installment, the regular one is rounded down instead.
 */
export function installmentPlan(amount: number, installments: number): { regular: number; last: number } {
  const total = Math.round(amount);
  const n = Math.max(1, Math.floor(installments));
  if (n === 1) return { regular: total, last: total };
  let regular = Math.round(total / n);
  if (total - regular * (n - 1) < 1) regular = Math.floor(total / n);
  return { regular, last: total - regular * (n - 1) };
}

/** Every installment in order; they add up to the amount exactly. */
export function splitInstallments(amount: number, installments: number): number[] {
  const { regular, last } = installmentPlan(amount, installments);
  const n = Math.max(1, Math.floor(installments));
  return [...Array<number>(n - 1).fill(regular), last];
}

export function outstandingBalance(amount: number, repayments: readonly Pick<RepaymentRecord, "amount">[]): number {
  return Math.max(0, Math.round(amount) - repayments.reduce((s, r) => s + Math.round(r.amount), 0));
}

/** What the next installment takes from a balance: the regular installment, or the whole balance once it is a final installment's worth. */
function nextInstallment(balance: number, plan: { regular: number; last: number }): number {
  if (balance <= 0) return 0;
  return balance <= Math.max(plan.regular, plan.last) ? balance : plan.regular;
}

/** How many more installments a balance needs at this plan. */
export function installmentsLeft(balance: number, plan: { regular: number; last: number }): number {
  if (balance <= 0) return 0;
  const finalSize = Math.max(plan.regular, plan.last);
  if (balance <= finalSize || plan.regular <= 0) return 1;
  return Math.ceil((balance - finalSize) / plan.regular) + 1;
}

/**
 * The installment a loan deducts in a payroll month, or null when nothing is due: the loan is not approved
 * (pending, rejected, completed, cancelled), the month is before the start month or paused, or it is fully repaid.
 * A payroll repayment already recorded for this very month (an approved run) is ignored, so the answer is stable.
 */
export function loanDueFor(
  loanId: string,
  loan: LoanTerms,
  repayments: readonly RepaymentRecord[],
  pauses: readonly PauseRecord[],
  year: number,
  month: number,
): LoanDue | null {
  if (loan.status !== "APPROVED") return null;
  const target = monthIndex(year, month);
  if (target < monthIndex(loan.startYear, loan.startMonth)) return null;
  if (pauses.some((p) => monthIndex(p.year, p.month) === target)) return null;

  const counted = repayments.filter((r) => !(r.source === "PAYROLL" && monthIndex(r.year, r.month) === target));
  const balance = outstandingBalance(loan.amount, counted);
  if (balance <= 0) return null;

  const plan = installmentPlan(loan.amount, loan.installments);
  const amount = nextInstallment(balance, plan);
  const paidMonths = new Set(counted.filter((r) => r.source === "PAYROLL" && monthIndex(r.year, r.month) < target).map((r) => monthIndex(r.year, r.month)));
  const installmentNo = paidMonths.size + 1;
  return { loanId, amount, installmentNo, totalInstallments: installmentNo + installmentsLeft(balance - amount, plan) };
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
  `Loan repayment (installment ${d.installmentNo} of ${d.totalInstallments})${d.requested !== undefined && d.amount < d.requested ? " — reduced to keep net pay above zero" : ""}`;

// ───────────── Month-by-month schedule ─────────────

export type ScheduleRowStatus = "PAID" | "PAUSED" | "NOT_DEDUCTED" | "UPCOMING";

export type ScheduleRow = {
  year: number;
  month: number;
  key: string;
  /** Installment number for rows that take one (paid through payroll or upcoming) */
  installmentNo: number | null;
  status: ScheduleRowStatus;
  /** Deducted through payroll (PAID) or expected (UPCOMING) */
  amount: number;
  /** Cash repaid in this month */
  cash: number;
  /** Balance after this month */
  balanceAfter: number;
};

const MAX_SCHEDULE_ROWS = 240;

/**
 * The whole schedule from the start month: what happened in months whose payroll is closed (approved or paid),
 * and what is expected from then on given the current balance and pauses. Months before the start month are
 * included only when they hold a cash payment.
 */
export function buildSchedule(
  loan: LoanTerms,
  repayments: readonly RepaymentRecord[],
  pauses: readonly PauseRecord[],
  closedMonths: ReadonlySet<string>,
): ScheduleRow[] {
  const plan = installmentPlan(loan.amount, loan.installments);
  const start = monthIndex(loan.startYear, loan.startMonth);
  const paused = new Set(pauses.map((p) => monthIndex(p.year, p.month)));
  const byMonth = new Map<number, { payroll: number; cash: number }>();
  for (const r of repayments) {
    const m = byMonth.get(monthIndex(r.year, r.month)) ?? { payroll: 0, cash: 0 };
    if (r.source === "PAYROLL") m.payroll += Math.round(r.amount);
    else m.cash += Math.round(r.amount);
    byMonth.set(monthIndex(r.year, r.month), m);
  }
  const recordedMonths = [...byMonth.keys()];
  const lastRecorded = recordedMonths.length ? Math.max(...recordedMonths) : start;
  const first = Math.min(start, ...recordedMonths);
  // Approved loans project the rest of the schedule; a pending request shows its planned schedule.
  const projecting = loan.status === "APPROVED" || loan.status === "PENDING";

  const rows: ScheduleRow[] = [];
  let balance = Math.round(loan.amount);
  let installmentNo = 0;
  for (let i = first; rows.length < MAX_SCHEDULE_ROWS; i++) {
    const { year, month } = fromMonthIndex(i);
    const key = monthKey(year, month);
    const rec = byMonth.get(i) ?? { payroll: 0, cash: 0 };
    const closed = closedMonths.has(key);
    if (i > lastRecorded && (balance <= 0 || !projecting)) break;

    let status: ScheduleRowStatus;
    let amount = 0;
    let number: number | null = null;
    if (rec.payroll > 0) {
      status = "PAID";
      amount = rec.payroll;
      number = ++installmentNo;
    } else if (i < start) {
      if (rec.cash === 0) continue;
      status = "NOT_DEDUCTED";
    } else if (paused.has(i)) {
      status = "PAUSED";
    } else if (closed || !projecting || balance - rec.cash <= 0) {
      status = "NOT_DEDUCTED";
    } else {
      status = "UPCOMING";
      amount = nextInstallment(balance - rec.cash, plan);
      number = ++installmentNo;
    }
    balance = Math.max(0, balance - rec.cash - amount);
    rows.push({ year, month, key, installmentNo: number, status, amount, cash: rec.cash, balanceAfter: balance });
  }
  return rows;
}
