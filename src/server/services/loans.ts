import "server-only";
import { Prisma, type LoanStatus, type PayrollRun } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { canAccessEmployee, scopedEmployeeWhere } from "@/server/auth/scope";
import { isPayrollLockedFor } from "@/server/services/payroll-lock";
import {
  buildMonthList, fromMonthIndex, loanDueFor, MAX_LOAN_AMOUNT, monthIndex, monthKey, outstandingBalance,
  type LoanDue, type LoanTerms, type MonthOverride, type RepaymentRecord,
} from "@/core/loans/schedule";
import type { PayLine } from "@/core/payroll/calculate";
import { parseDateOnly, todayInPKT } from "@/lib/dates";
import { attendanceStartOf } from "@/server/json-fields";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const loanMonthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

/** A loan can start at most this many months after the current month. */
const MAX_MONTHS_AHEAD = 12;

type LoanWithHistory = Prisma.LoanGetPayload<{ include: { repayments: true; monthOverrides: true } }>;

const termsOf = (l: { amount: Prisma.Decimal; status: LoanStatus }): LoanTerms => ({ amount: Number(l.amount), status: l.status });
const overridesOf = (l: { monthOverrides: { year: number; month: number; amount: Prisma.Decimal | null }[] }): MonthOverride[] =>
  l.monthOverrides.map((o) => ({ year: o.year, month: o.month, amount: o.amount === null ? null : Number(o.amount) }));
const repaymentsOf = (l: LoanWithHistory): RepaymentRecord[] =>
  l.repayments.map((r) => ({ amount: Number(r.amount), source: r.source, year: r.year, month: r.month }));
const balanceOf = (l: LoanWithHistory) => outstandingBalance(Number(l.amount), l.repayments.map((r) => ({ amount: Number(r.amount) })));

// ───────────── Months ─────────────

/** The earliest month an installment can be entered for: after the last closed payroll, and not before attendance is tracked. */
export async function firstOpenPayrollMonth(): Promise<{ year: number; month: number }> {
  const [lastClosed, company] = await Promise.all([
    db.payrollRun.findFirst({ where: { status: { in: ["APPROVED", "PAID"] } }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { year: true, month: true } }),
    db.company.findFirst({ select: { attendanceStartDate: true } }),
  ]);
  const start = attendanceStartOf(company);
  const candidates = [lastClosed ? monthIndex(lastClosed.year, lastClosed.month) + 1 : 0, start ? monthIndex(Number(start.slice(0, 4)), Number(start.slice(5, 7))) : 0];
  if (candidates.every((c) => c === 0)) {
    const today = todayInPKT();
    return { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
  }
  return fromMonthIndex(Math.max(...candidates));
}

async function assertOpenMonth(year: number, month: number, what: string) {
  const open = await firstOpenPayrollMonth();
  if (monthIndex(year, month) < monthIndex(open.year, open.month) || (await isPayrollLockedFor(`${monthKey(year, month)}-01`))) {
    throw new AppError(`${what} must be ${loanMonthLabel(open.year, open.month)} or later — payroll for earlier months is closed or was done in the previous software.`);
  }
}

async function assertStartMonth(year: number, month: number) {
  await assertOpenMonth(year, month, "The deduction month");
  const today = todayInPKT();
  if (monthIndex(year, month) > monthIndex(today.getUTCFullYear(), today.getUTCMonth() + 1) + MAX_MONTHS_AHEAD) {
    throw new AppError(`The deduction month can be at most ${MAX_MONTHS_AHEAD} months from now.`);
  }
}

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_LOAN_AMOUNT) throw new AppError("Enter a whole-rupee amount between 1 and 10,000,000.");
}

// ───────────── Requests & decisions ─────────────

export type LoanInput = {
  amount: number;
  reason: string;
  /** "YYYY-MM-DD" */
  givenOn: string;
  /** Optional installment to deduct in one payroll month */
  deduct?: { year: number; month: number; amount: number };
};

/**
 * HR/Finance records a loan directly for an employee; it is approved at once. There is no monthly plan: only the
 * installments HR enters for a month are deducted (optionally the first one right here).
 */
export async function createLoan(actor: Actor, input: LoanInput & { employeeId: string }) {
  assertPermission(actor, "loan.manage", "all");
  if (input.employeeId === actor.employeeId) throw new ForbiddenError("You cannot give yourself a loan — another HR/Finance user must add it.");
  assertAmount(input.amount);
  if (input.reason.trim().length < 3) throw new AppError("Give a reason for the loan.");
  const givenOn = parseDateOnly(input.givenOn);
  if (givenOn > todayInPKT()) throw new AppError("The date given cannot be in the future.");
  if (input.deduct) {
    if (!Number.isInteger(input.deduct.amount) || input.deduct.amount < 1) throw new AppError("Enter a whole-rupee installment of at least Rs 1, or leave it empty.");
    if (input.deduct.amount > input.amount) throw new AppError("The installment cannot be more than the loan amount.");
    await assertStartMonth(input.deduct.year, input.deduct.month);
  }
  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, status: true } });
  if (!employee) throw new NotFoundError("Employee not found.");
  if (employee.status !== "ACTIVE") throw new AppError("Loans can only be given to active employees.");

  const deduct = input.deduct;
  const start = deduct ?? { year: givenOn.getUTCFullYear(), month: givenOn.getUTCMonth() + 1 };
  return db.$transaction(async (tx) => {
    const loan = await tx.loan.create({
      data: {
        employeeId: employee.id, amount: new Prisma.Decimal(input.amount), givenOn,
        startYear: start.year, startMonth: start.month, reason: input.reason.trim(), status: "APPROVED",
        requestedById: actor.userId, decidedById: actor.userId, decidedAt: new Date(), decisionNote: "Recorded by HR/Finance",
      },
    });
    if (deduct) {
      await tx.loanMonthOverride.create({
        data: { loanId: loan.id, year: deduct.year, month: deduct.month, amount: new Prisma.Decimal(deduct.amount), createdById: actor.userId },
      });
    }
    await recordAudit(
      {
        actor, action: "loan.create", entityType: "Loan", entityId: loan.id,
        after: { ...loan, firstInstallment: deduct ? { month: monthKey(deduct.year, deduct.month), amount: deduct.amount } : null },
      },
      tx,
    );
    return loan;
  });
}

async function loadLoan(id: string) {
  const loan = await db.loan.findUnique({ where: { id }, include: { repayments: true, monthOverrides: true, employee: { select: { id: true, fullName: true } } } });
  if (!loan) throw new NotFoundError("Loan not found.");
  return loan;
}

/**
 * Approve (optionally moving the first deduction month) or reject a pending request (from before employees stopped
 * requesting loans). Nobody decides their own loan.
 */
export async function decideLoan(actor: Actor, id: string, approve: boolean, note: string, start?: { year: number; month: number }) {
  assertPermission(actor, "loan.manage", "all");
  const loan = await loadLoan(id);
  if (loan.status !== "PENDING") throw new AppError(`This request is already ${loan.status.toLowerCase()}.`);
  if (loan.employeeId === actor.employeeId) throw new ForbiddenError("You cannot approve or reject your own loan.");
  const startYear = start?.year ?? loan.startYear;
  const startMonth = start?.month ?? loan.startMonth;
  if (approve) await assertStartMonth(startYear, startMonth);
  else if (note.trim().length < 3) throw new AppError("Explain why the request is rejected.");

  const after = await db.loan.update({
    where: { id },
    data: {
      status: approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: note.trim() || null,
      ...(approve ? { startYear, startMonth } : {}),
    },
  });
  await recordAudit({
    actor, action: approve ? "loan.approve" : "loan.reject", entityType: "Loan", entityId: id,
    before: { status: loan.status, startYear: loan.startYear, startMonth: loan.startMonth },
    after: { status: after.status, startYear: after.startYear, startMonth: after.startMonth, note: after.decisionNote },
  });
}

/**
 * HR/Finance cancels a pending or running loan (the outstanding balance is written off), or the employee withdraws
 * their own pending request (requests made before employees stopped requesting loans).
 */
export async function cancelLoan(actor: Actor, id: string, note: string) {
  const loan = await loadLoan(id);
  const own = loan.employeeId === actor.employeeId;
  const manager = can(actor, "loan.manage", "all");
  if (loan.status !== "PENDING" && loan.status !== "APPROVED") throw new AppError(`This loan is ${loan.status.toLowerCase()} and cannot be cancelled.`);
  if (loan.status === "PENDING" ? !own && !manager : !manager || own) {
    throw new ForbiddenError(loan.status === "APPROVED" ? "Only HR/Finance can cancel a running loan, and not their own." : undefined);
  }
  if (loan.status === "APPROVED" && note.trim().length < 3) throw new AppError("Give a reason — the outstanding balance is written off.");

  const writtenOff = loan.status === "APPROVED" ? balanceOf(loan) : 0;
  await db.loan.update({ where: { id }, data: { status: "CANCELLED", cancelledById: actor.userId, cancelledAt: new Date(), cancelNote: note.trim() || null } });
  await recordAudit({
    actor, action: "loan.cancel", entityType: "Loan", entityId: id,
    before: { status: loan.status }, after: { status: "CANCELLED", writtenOff, note: note.trim() || null },
  });
}

// ───────────── Running loans ─────────────

function assertRunning(loan: { status: LoanStatus }) {
  if (loan.status !== "APPROVED") throw new AppError(`This loan is ${loan.status.toLowerCase()}; only running loans can be changed.`);
}

function assertNotOwn(actor: Actor, loan: { employeeId: string }) {
  if (loan.employeeId === actor.employeeId) throw new ForbiddenError("You cannot change the installments of your own loan.");
}

/** A month HR can still change: open payroll, not locked, not too far ahead, and not already paid through an approved payroll. */
async function assertChangeableMonth(loan: LoanWithHistory, year: number, month: number) {
  await assertStartMonth(year, month);
  if (loan.repayments.some((r) => r.source === "PAYROLL" && r.year === year && r.month === month)) {
    throw new AppError(`${loanMonthLabel(year, month)} was already deducted through an approved payroll.`);
  }
}

/**
 * The installment to deduct in one payroll month (never more than the outstanding balance). 0 stores a skip: nothing
 * is deducted that month. Later months without an entry keep repeating the latest entry above 0.
 */
export async function setMonthInstallment(actor: Actor, loanId: string, year: number, month: number, amount: number) {
  assertPermission(actor, "loan.manage", "all");
  const loan = await loadLoan(loanId);
  assertRunning(loan);
  assertNotOwn(actor, loan);
  await assertChangeableMonth(loan, year, month);
  const balance = balanceOf(loan);
  if (!Number.isInteger(amount) || amount < 0) throw new AppError("Enter a whole-rupee amount (0 skips the month).");
  if (amount > balance) throw new AppError(`The outstanding balance is only Rs ${balance.toLocaleString("en-PK")}.`);

  const existing = loan.monthOverrides.find((o) => o.year === year && o.month === month);
  const before = existing && existing.amount !== null ? Math.max(0, Math.round(Number(existing.amount))) : null;
  if (before === amount) return;
  await db.loanMonthOverride.upsert({
    where: { loanId_year_month: { loanId, year, month } },
    create: { loanId, year, month, amount: new Prisma.Decimal(amount), createdById: actor.userId },
    update: { amount: new Prisma.Decimal(amount), createdById: actor.userId },
  });
  await recordAudit({
    actor, action: amount === 0 ? "loan.month_installment_skip" : "loan.month_installment", entityType: "Loan", entityId: loanId,
    before: { month: monthKey(year, month), amount: before }, after: { month: monthKey(year, month), amount },
  });
}

/** Remove a month's entry, so it falls back to the default (repeating the latest earlier entry above 0). */
export async function clearMonthInstallment(actor: Actor, loanId: string, year: number, month: number) {
  assertPermission(actor, "loan.manage", "all");
  const loan = await loadLoan(loanId);
  assertRunning(loan);
  assertNotOwn(actor, loan);
  await assertChangeableMonth(loan, year, month);
  const existing = loan.monthOverrides.find((o) => o.year === year && o.month === month);
  if (!existing) return;
  await db.loanMonthOverride.delete({ where: { id: existing.id } });
  await recordAudit({
    actor, action: "loan.month_installment_clear", entityType: "Loan", entityId: loanId,
    before: { month: monthKey(year, month), amount: existing.amount === null ? null : Number(existing.amount) },
    after: { month: monthKey(year, month), amount: null },
  });
}

/** Money paid back outside payroll. Completes the loan when nothing is left. */
export async function recordCashRepayment(actor: Actor, loanId: string, input: { paidOn: string; amount: number; note?: string }) {
  assertPermission(actor, "loan.manage", "all");
  const loan = await loadLoan(loanId);
  assertRunning(loan);
  const paidOn = parseDateOnly(input.paidOn);
  if (paidOn > todayInPKT()) throw new AppError("The payment date cannot be in the future.");
  const balance = balanceOf(loan);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter a whole-rupee amount.");
  if (input.amount > balance) throw new AppError(`The outstanding balance is only Rs ${balance.toLocaleString("en-PK")}.`);

  const completed = input.amount === balance;
  await db.$transaction(async (tx) => {
    const repayment = await tx.loanRepayment.create({
      data: {
        loanId, amount: new Prisma.Decimal(input.amount), source: "CASH", year: paidOn.getUTCFullYear(), month: paidOn.getUTCMonth() + 1,
        paidOn, note: input.note?.trim() || null, createdById: actor.userId,
      },
    });
    if (completed) await tx.loan.update({ where: { id: loanId }, data: { status: "COMPLETED" } });
    await recordAudit(
      { actor, action: "loan.cash_repayment", entityType: "Loan", entityId: loanId, after: { ...repayment, balanceAfter: balance - input.amount, completed } },
      tx,
    );
  });
}

// ───────────── Payroll ─────────────

/** Installments due (entered or repeated), per employee for a payroll month (oldest loan first), before the net-pay cap. */
export async function loanDeductionsFor(employeeIds: string[], year: number, month: number): Promise<Map<string, LoanDue[]>> {
  const map = new Map<string, LoanDue[]>();
  if (employeeIds.length === 0) return map;
  const loans = await db.loan.findMany({
    where: { employeeId: { in: employeeIds }, status: "APPROVED" },
    include: { repayments: true, monthOverrides: true },
    orderBy: { createdAt: "asc" },
  });
  for (const l of loans) {
    const due = loanDueFor(l.id, termsOf(l), repaymentsOf(l), overridesOf(l), year, month);
    if (due) (map.get(l.employeeId) ?? map.set(l.employeeId, []).get(l.employeeId)!).push(due);
  }
  return map;
}

/**
 * Called inside approveRun's transaction: records each LOAN line of the run as a repayment and completes loans
 * that reach zero. Refuses (rolling the approval back) if a loan changed since the run was calculated.
 */
export async function recordPayrollRepayments(tx: Prisma.TransactionClient, actor: Actor, run: PayrollRun) {
  const items = await tx.payrollItem.findMany({ where: { runId: run.id }, select: { id: true, employeeId: true, employeeCode: true, lines: true, netPay: true } });
  const loanLines = (i: (typeof items)[number]) =>
    (Array.isArray(i.lines) ? (i.lines as unknown as PayLine[]) : []).filter((l) => l && l.code === "LOAN" && typeof l.loanId === "string");
  const wanted = items.flatMap((i) =>
    loanLines(i).filter((l) => l.amount > 0).map((l) => ({ item: i, loanId: l.loanId!, amount: Math.round(l.amount), planned: l.planned })),
  );
  const employeeIds = items.map((i) => i.employeeId).filter((v): v is string => !!v);
  const runLoans = await tx.loan.findMany({
    where: { OR: [{ id: { in: wanted.map((w) => w.loanId) } }, { employeeId: { in: employeeIds }, status: "APPROVED" }] },
    include: { repayments: true, monthOverrides: true },
  });
  const loans = new Map(runLoans.map((l) => [l.id, l]));
  const paidOn = todayInPKT();
  const stale = (code: string, why: string) =>
    new AppError(`${code}: ${why} since this payroll was calculated. Send it back to HR to recalculate, then approve again.`);
  const dueNow = (l: LoanWithHistory) => loanDueFor(l.id, termsOf(l), repaymentsOf(l), overridesOf(l), run.year, run.month);

  // An installment that was entered (or became due by repeating) after calculation is missing from
  // the run. With net pay at 0 the line may have been capped away, so it is only flagged when there was room.
  for (const i of items) {
    if (!i.employeeId || Number(i.netPay) <= 0) continue;
    const inRun = new Set(loanLines(i).map((l) => l.loanId));
    for (const l of runLoans) {
      if (l.employeeId !== i.employeeId || l.status !== "APPROVED" || inRun.has(l.id)) continue;
      if (l.repayments.some((r) => r.payrollItemId === i.id)) continue;
      if (dueNow(l)) throw stale(i.employeeCode, "a loan installment was entered");
    }
  }

  for (const w of wanted) {
    const loan = loans.get(w.loanId);
    if (!loan || loan.employeeId !== w.item.employeeId) throw stale(w.item.employeeCode, "a loan was removed");
    if (loan.repayments.some((r) => r.payrollItemId === w.item.id)) continue;
    if (loan.status !== "APPROVED") throw stale(w.item.employeeCode, `a loan became ${loan.status.toLowerCase()}`);
    const due = dueNow(loan);
    if (!due) throw stale(w.item.employeeCode, "a loan installment was removed");
    // `planned` is the entered installment before the net-pay cap; lines calculated before it was stored get the checks below.
    if (w.planned !== undefined && Math.round(w.planned) !== due.amount) throw stale(w.item.employeeCode, "a loan installment was changed");
    if (w.amount > due.amount) throw stale(w.item.employeeCode, "a loan installment was lowered");
    const balance = balanceOf(loan);
    if (w.amount > balance) throw stale(w.item.employeeCode, "a loan balance went down");

    const repayment = await tx.loanRepayment.create({
      data: {
        loanId: loan.id, amount: new Prisma.Decimal(w.amount), source: "PAYROLL", payrollItemId: w.item.id, year: run.year, month: run.month,
        paidOn, note: `Payroll ${loanMonthLabel(run.year, run.month)}`, createdById: actor.userId,
      },
    });
    loan.repayments.push(repayment);
    const completed = w.amount === balance;
    if (completed) await tx.loan.update({ where: { id: loan.id }, data: { status: "COMPLETED" } });
    await recordAudit(
      {
        actor, action: "loan.payroll_repayment", entityType: "Loan", entityId: loan.id,
        after: { payrollRunId: run.id, month: monthKey(run.year, run.month), amount: w.amount, balanceAfter: balance - w.amount, completed },
      },
      tx,
    );
  }
}

// ───────────── Reads ─────────────

const listInclude = {
  employee: { select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } } },
  repayments: true,
  monthOverrides: true,
} satisfies Prisma.LoanInclude;

type ListedLoan = Prisma.LoanGetPayload<{ include: typeof listInclude }>;

function summarise(l: ListedLoan, open: { year: number; month: number }) {
  const outstanding = balanceOf(l);
  // The first open payroll month (or later) that deducts something (entered or repeated), before the net-pay cap.
  let next: { year: number; month: number; amount: number } | null = null;
  if (l.status === "APPROVED") {
    const from = monthIndex(open.year, open.month);
    const overrides = overridesOf(l);
    const last = Math.max(from, ...overrides.map((o) => monthIndex(o.year, o.month) + 1));
    for (let i = from; i <= last; i++) {
      const { year, month } = fromMonthIndex(i);
      const due = loanDueFor(l.id, termsOf(l), repaymentsOf(l), overrides, year, month);
      if (due) {
        next = { year, month, amount: due.amount };
        break;
      }
    }
  }
  return {
    id: l.id,
    employee: l.employee,
    amount: Number(l.amount),
    givenOn: l.givenOn,
    reason: l.reason,
    status: l.status,
    decisionNote: l.decisionNote,
    cancelNote: l.cancelNote,
    createdAt: l.createdAt,
    repaid: Number(l.amount) - outstanding,
    outstanding: l.status === "CANCELLED" || l.status === "REJECTED" ? 0 : outstanding,
    next,
  };
}

export type LoanRow = ReturnType<typeof summarise>;
export type LoanView = "pending" | "active" | "closed";

const VIEW_STATUSES: Record<LoanView, LoanStatus[]> = {
  pending: ["PENDING"],
  active: ["APPROVED"],
  closed: ["COMPLETED", "REJECTED", "CANCELLED"],
};

/** Loans of the employees the actor may see, by status group. */
export async function listLoans(actor: Actor, view: LoanView): Promise<LoanRow[]> {
  assertPermission(actor, "loan.read", "team");
  const scope = await scopedEmployeeWhere(actor, "loan.read");
  const [loans, open] = await Promise.all([
    db.loan.findMany({ where: { employee: scope, status: { in: VIEW_STATUSES[view] } }, include: listInclude, orderBy: { createdAt: view === "pending" ? "asc" : "desc" }, take: 300 }),
    firstOpenPayrollMonth(),
  ]);
  return loans.map((l) => summarise(l, open));
}

export async function myLoans(actor: Actor): Promise<LoanRow[]> {
  if (!actor.employeeId) return [];
  assertPermission(actor, "loan.read", "self");
  const [loans, open] = await Promise.all([
    db.loan.findMany({ where: { employeeId: actor.employeeId }, include: listInclude, orderBy: { createdAt: "desc" }, take: 100 }),
    firstOpenPayrollMonth(),
  ]);
  return loans.map((l) => summarise(l, open));
}

/** Pending requests the actor may decide (everyone's but their own). */
export async function pendingLoanCount(actor: Actor): Promise<number> {
  if (!can(actor, "loan.manage", "all")) return 0;
  return db.loan.count({ where: { status: "PENDING", ...(actor.employeeId ? { NOT: { employeeId: actor.employeeId } } : {}) } });
}

/** Running loans of one employee: balance and the next expected deduction (for the ESS dashboard). */
export async function activeLoanSummary(employeeId: string) {
  const [loans, open, pendingRequests] = await Promise.all([
    db.loan.findMany({ where: { employeeId, status: "APPROVED" }, include: listInclude, orderBy: { createdAt: "asc" } }),
    firstOpenPayrollMonth(),
    db.loan.count({ where: { employeeId, status: "PENDING" } }),
  ]);
  const rows = loans.map((l) => summarise(l, open));
  return { count: rows.length, outstanding: rows.reduce((s, r) => s + r.outstanding, 0), pendingRequests };
}

/** One loan with its month-by-month list and repayment history. */
export async function getLoan(actor: Actor, id: string) {
  const loan = await db.loan.findUnique({ where: { id }, include: { ...listInclude, repayments: { orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }] } } });
  if (!loan) throw new NotFoundError("Loan not found.");
  if (!(await canAccessEmployee(actor, "loan.read", loan.employeeId))) throw new ForbiddenError();
  const open = await firstOpenPayrollMonth();
  const userIds = [loan.requestedById, loan.decidedById, loan.cancelledById, ...loan.repayments.map((r) => r.createdById)].filter((v): v is string => !!v);
  const users = await db.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, displayName: true } });
  const name = (uid: string | null) => users.find((u) => u.id === uid)?.displayName ?? null;

  return {
    ...summarise(loan, open),
    isOwn: loan.employeeId === actor.employeeId,
    requestedBy: name(loan.requestedById),
    decidedBy: name(loan.decidedById),
    decidedAt: loan.decidedAt,
    cancelledBy: name(loan.cancelledById),
    cancelledAt: loan.cancelledAt,
    firstOpenMonth: monthKey(open.year, open.month),
    months: buildMonthList(termsOf(loan), repaymentsOf(loan), overridesOf(loan), open).map((r) => ({ ...r, label: loanMonthLabel(r.year, r.month) })),
    repayments: loan.repayments.map((r) => ({
      id: r.id, amount: Number(r.amount), source: r.source, paidOn: r.paidOn, monthLabel: loanMonthLabel(r.year, r.month), note: r.note, by: name(r.createdById),
    })),
  };
}
