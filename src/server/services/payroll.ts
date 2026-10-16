import "server-only";
import { Prisma, type PayrollRun } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { calculatePay, type AttendanceStatusCode } from "@/core/payroll/calculate";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

const d0 = (iso: string) => new Date(`${iso}T00:00:00Z`);
const monthBounds = (year: number, month: number) => {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = toDateOnlyString(new Date(Date.UTC(year, month, 0)));
  return { start, end };
};

/** True when attendance for this date belongs to a payroll that is approved or paid (and so must not change). */
export async function isPayrollLockedFor(date: string): Promise<boolean> {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const run = await db.payrollRun.findUnique({ where: { year_month: { year: y, month: m } }, select: { status: true } });
  return !!run && (run.status === "APPROVED" || run.status === "PAID");
}

// ───────────── Calculation ─────────────

async function calculateRunItems(run: PayrollRun, onlyEmployeeId?: string) {
  const { start, end } = monthBounds(run.year, run.month);
  const today = toDateOnlyString(todayInPKT());
  const company = await db.company.findFirst({ select: { weekendDays: true } });

  const employees = await db.employee.findMany({
    where: {
      ...(onlyEmployeeId ? { id: onlyEmployeeId } : {}),
      joiningDate: { lte: d0(end) },
      OR: [{ exitDate: null }, { exitDate: { gte: d0(start) } }],
      NOT: { status: "INACTIVE", exitDate: null }, // deactivated without an exit date: excluded until HR sets one
    },
    include: {
      department: { select: { name: true } },
      designation: { select: { title: true } },
      salaryStructures: { orderBy: { effectiveFrom: "desc" }, include: { allowances: true } },
      attendanceDays: { where: { workDate: { gte: d0(start), lte: d0(end) } }, select: { workDate: true, status: true } },
    },
  });

  const existing = await db.payrollItem.findMany({
    where: { runId: run.id, ...(onlyEmployeeId ? { employeeId: onlyEmployeeId } : {}) },
    include: { adjustments: true },
  });
  const existingByEmployee = new Map(existing.map((i) => [i.employeeId, i]));

  for (const e of employees) {
    const lastDay = e.exitDate && toDateOnlyString(e.exitDate) < end ? toDateOnlyString(e.exitDate) : end;
    const salary = e.salaryStructures.find((s) => toDateOnlyString(s.effectiveFrom) <= lastDay) ?? null;
    const prior = existingByEmployee.get(e.id);
    const result = calculatePay({
      year: run.year,
      month: run.month,
      today,
      joiningDate: toDateOnlyString(e.joiningDate),
      exitDate: e.exitDate ? toDateOnlyString(e.exitDate) : null,
      weekendDays: company?.weekendDays ?? [0, 6],
      salary: salary ? { basic: Number(salary.basicSalary), allowances: salary.allowances.map((a) => ({ name: a.name, amount: Number(a.amount) })) } : null,
      days: new Map(e.attendanceDays.map((d) => [toDateOnlyString(d.workDate), d.status as AttendanceStatusCode])),
      adjustments: (prior?.adjustments ?? []).map((a) => ({ kind: a.kind, label: a.label, amount: Number(a.amount) })),
    });
    const data = {
      employeeCode: e.employeeCode,
      fullName: e.fullName,
      department: e.department?.name ?? null,
      designation: e.designation?.title ?? null,
      basicSalary: new Prisma.Decimal(salary ? Number(salary.basicSalary) : 0),
      allowances: (salary?.allowances ?? []).map((a) => ({ name: a.name, amount: Number(a.amount) })),
      grossSalary: new Prisma.Decimal(result.gross),
      daysInMonth: result.daysInMonth,
      perDayRate: new Prisma.Decimal(result.perDayRate),
      employedDays: result.employedDays,
      presentDays: result.presentDays,
      absentDays: result.absentDays,
      lateCount: result.lateCount,
      missingPunchCount: result.missingPunchCount,
      lateDeductionDays: result.lateDeductionDays,
      notSyncedDays: result.notSyncedDays,
      earnings: new Prisma.Decimal(result.earnings),
      deductions: new Prisma.Decimal(result.deductions),
      netPay: new Prisma.Decimal(result.netPay),
      lines: result.lines,
      warnings: result.warnings,
    };
    await db.payrollItem.upsert({
      where: { runId_employeeId: { runId: run.id, employeeId: e.id } },
      create: { runId: run.id, employeeId: e.id, ...data },
      update: data,
    });
  }

  // Employees no longer in scope for this month (e.g. joining date corrected) are removed from a draft.
  if (!onlyEmployeeId) {
    await db.payrollItem.deleteMany({ where: { runId: run.id, OR: [{ employeeId: null }, { employeeId: { notIn: employees.map((e) => e.id) } }] } });
  }
  await db.payrollRun.update({ where: { id: run.id }, data: { calculatedAt: new Date() } });
}

function assertDraft(run: PayrollRun) {
  if (run.status !== "DRAFT") throw new AppError(`This payroll is ${run.status.toLowerCase()} and can no longer be changed.`);
}

async function loadRun(runId: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Payroll not found.");
  return run;
}

/** Create the month's payroll, or recalculate it while it is still a draft. */
export async function prepareRun(actor: Actor, year: number, month: number) {
  assertPermission(actor, "payroll.prepare", "all");
  const today = todayInPKT();
  if (year > today.getUTCFullYear() || (year === today.getUTCFullYear() && month > today.getUTCMonth() + 1)) {
    throw new AppError("You cannot prepare payroll for a future month.");
  }
  let run = await db.payrollRun.findUnique({ where: { year_month: { year, month } } });
  if (run) assertDraft(run);
  run ??= await db.payrollRun.create({ data: { year, month, preparedById: actor.userId } });
  await calculateRunItems(run);
  await recordAudit({ actor, action: "payroll.calculate", entityType: "PayrollRun", entityId: run.id, after: { month: monthName(year, month) } });
  return run;
}

export async function recalculateRun(actor: Actor, runId: string) {
  assertPermission(actor, "payroll.prepare", "all");
  const run = await loadRun(runId);
  assertDraft(run);
  await calculateRunItems(run);
  await recordAudit({ actor, action: "payroll.calculate", entityType: "PayrollRun", entityId: run.id, after: { month: monthName(run.year, run.month) } });
}

// ───────────── Adjustments ─────────────

export async function addPayrollAdjustment(actor: Actor, itemId: string, input: { kind: "EARNING" | "DEDUCTION"; label: string; amount: number }) {
  assertPermission(actor, "payroll.prepare", "all");
  const item = await db.payrollItem.findUnique({ where: { id: itemId }, include: { run: true } });
  if (!item) throw new NotFoundError("Payroll line not found.");
  assertDraft(item.run);
  if (!item.employeeId) throw new AppError("This employee no longer exists.");
  const adj = await db.payrollAdjustment.create({ data: { itemId, kind: input.kind, label: input.label, amount: new Prisma.Decimal(input.amount), createdById: actor.userId } });
  await calculateRunItems(item.run, item.employeeId);
  await recordAudit({ actor, action: "payroll.adjustment_add", entityType: "PayrollRun", entityId: item.runId, after: { employeeCode: item.employeeCode, ...input, id: adj.id } });
}

export async function removePayrollAdjustment(actor: Actor, adjustmentId: string) {
  assertPermission(actor, "payroll.prepare", "all");
  const adj = await db.payrollAdjustment.findUnique({ where: { id: adjustmentId }, include: { item: { include: { run: true } } } });
  if (!adj) throw new NotFoundError("Adjustment not found.");
  assertDraft(adj.item.run);
  await db.payrollAdjustment.delete({ where: { id: adjustmentId } });
  if (adj.item.employeeId) await calculateRunItems(adj.item.run, adj.item.employeeId);
  await recordAudit({
    actor, action: "payroll.adjustment_remove", entityType: "PayrollRun", entityId: adj.item.runId,
    before: { employeeCode: adj.item.employeeCode, kind: adj.kind, label: adj.label, amount: adj.amount },
  });
}

// ───────────── Workflow ─────────────

export async function submitRun(actor: Actor, runId: string) {
  assertPermission(actor, "payroll.prepare", "all");
  const run = await loadRun(runId);
  assertDraft(run);
  await calculateRunItems(run); // submit exactly what the current attendance and salaries give
  await db.payrollRun.update({ where: { id: runId }, data: { status: "SUBMITTED", submittedById: actor.userId, submittedAt: new Date(), rejectedNote: null } });
  await recordAudit({ actor, action: "payroll.submit", entityType: "PayrollRun", entityId: runId, after: { month: monthName(run.year, run.month) } });
}

export async function approveRun(actor: Actor, runId: string) {
  assertPermission(actor, "payroll.approve", "all");
  const run = await loadRun(runId);
  if (run.status !== "SUBMITTED") throw new AppError("Only a submitted payroll can be approved.");
  // Maker–checker: whoever submitted cannot approve.
  if (run.submittedById === actor.userId) throw new ForbiddenError("You submitted this payroll, so someone else (Finance) must approve it.");
  const totals = await db.payrollItem.aggregate({ where: { runId }, _sum: { netPay: true }, _count: true });
  await db.payrollRun.update({ where: { id: runId }, data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() } });
  await recordAudit({
    actor, action: "payroll.approve", entityType: "PayrollRun", entityId: runId,
    after: { month: monthName(run.year, run.month), employees: totals._count, totalNet: totals._sum.netPay?.toString() ?? "0" },
  });
}

export async function rejectRun(actor: Actor, runId: string, note: string) {
  assertPermission(actor, "payroll.approve", "all");
  const run = await loadRun(runId);
  if (run.status !== "SUBMITTED") throw new AppError("Only a submitted payroll can be sent back.");
  if (note.trim().length < 3) throw new AppError("Explain what needs to change.");
  await db.payrollRun.update({ where: { id: runId }, data: { status: "DRAFT", rejectedNote: note.trim(), submittedById: null, submittedAt: null } });
  await recordAudit({ actor, action: "payroll.reject", entityType: "PayrollRun", entityId: runId, after: { month: monthName(run.year, run.month), note: note.trim() } });
}

export async function markRunPaid(actor: Actor, runId: string) {
  assertPermission(actor, "payroll.approve", "all");
  const run = await loadRun(runId);
  if (run.status !== "APPROVED") throw new AppError("Only an approved payroll can be marked as paid.");
  await db.payrollRun.update({ where: { id: runId }, data: { status: "PAID", paidAt: new Date() } });
  await recordAudit({ actor, action: "payroll.paid", entityType: "PayrollRun", entityId: runId, after: { month: monthName(run.year, run.month) } });
}

// ───────────── Reads ─────────────

export async function listRuns(actor: Actor) {
  assertPermission(actor, "payroll.read", "all");
  const runs = await db.payrollRun.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }] });
  const totals = await db.payrollItem.groupBy({ by: ["runId"], _sum: { netPay: true, grossSalary: true, deductions: true }, _count: { _all: true } });
  const byRun = new Map(totals.map((t) => [t.runId, t]));
  return runs.map((r) => ({
    ...r,
    label: monthName(r.year, r.month),
    employees: byRun.get(r.id)?._count._all ?? 0,
    totalNet: Number(byRun.get(r.id)?._sum.netPay ?? 0),
  }));
}

export async function getRun(actor: Actor, runId: string) {
  assertPermission(actor, "payroll.read", "all");
  const run = await db.payrollRun.findUnique({
    where: { id: runId },
    include: { items: { orderBy: { fullName: "asc" }, include: { adjustments: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!run) throw new NotFoundError("Payroll not found.");
  const userIds = [run.preparedById, run.submittedById, run.approvedById].filter((v): v is string => !!v);
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.displayName ?? null;
  return { ...run, label: monthName(run.year, run.month), preparedBy: name(run.preparedById), submittedBy: name(run.submittedById), approvedBy: name(run.approvedById) };
}

/** Approved/paid pay for one employee (newest first) — for their own payslip history. */
export async function employeePayHistory(employeeId: string) {
  const items = await db.payrollItem.findMany({
    where: { employeeId, run: { status: { in: ["APPROVED", "PAID"] } } },
    include: { run: { select: { year: true, month: true, status: true, approvedAt: true, paidAt: true } } },
    orderBy: [{ run: { year: "desc" } }, { run: { month: "desc" } }],
    take: 24,
  });
  return items.map((i) => ({ ...i, label: monthName(i.run.year, i.run.month) }));
}
