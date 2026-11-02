import "server-only";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { assertEmployeeAccess } from "@/server/auth/scope";
import { lockedPayrollMonths } from "@/server/services/payroll-lock";
import { salesMonthBlock } from "@/core/payroll/salary-revision";
import type { SalesMonthInput } from "@/lib/validation";

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Achieved as a percentage of target, one decimal (null when there is no target). */
export const percentOfTarget = (target: number, achieved: number) => (target > 0 ? Math.round((achieved / target) * 1000) / 10 : null);

function view(r: { target: unknown; achieved: unknown; commission: unknown }) {
  const target = Number(r.target);
  const achieved = Number(r.achieved);
  return { target, achieved, commission: Number(r.commission), percent: percentOfTarget(target, achieved) };
}

/** A sales employee's months, newest first, with whether payroll has locked each one. Needs salary.read on the employee. */
export async function listSalesMonths(actor: Actor, employeeId: string) {
  await assertEmployeeAccess(actor, "salary.read", employeeId);
  const [rows, locked] = await Promise.all([
    db.salesMonth.findMany({ where: { employeeId }, orderBy: [{ year: "desc" }, { month: "desc" }] }),
    lockedPayrollMonths(),
  ]);
  return rows.map((r) => ({ id: r.id, year: r.year, month: r.month, note: r.note, ...view(r), locked: locked.has(ym(r.year, r.month)) }));
}

/** The month's sales figures for one employee. No access checks: callers decide who may see it. */
export async function salesMonthFor(employeeId: string, year: number, month: number) {
  const r = await db.salesMonth.findUnique({ where: { employeeId_year_month: { employeeId, year, month } } });
  return r ? view(r) : null;
}

/** Commission per employee for a payroll month. Only employees still marked as sales are paid. */
export async function commissionsFor(employeeIds: string[], year: number, month: number): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await db.salesMonth.findMany({
    where: { employeeId: { in: employeeIds }, year, month, employee: { isSales: true } },
    select: { employeeId: true, commission: true },
  });
  return new Map(rows.map((r) => [r.employeeId, Number(r.commission)]));
}

async function assertMonthOpen(year: number, month: number) {
  const block = salesMonthBlock(ym(year, month), await lockedPayrollMonths());
  if (block) throw new AppError(block);
}

/** Add or update a month's target, achieved and commission. `salesMonthId` set = editing that row. */
export async function saveSalesMonth(actor: Actor, employeeId: string, input: SalesMonthInput, salesMonthId?: string) {
  assertPermission(actor, "salary.manage", "all");
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { isSales: true } });
  if (!employee) throw new NotFoundError("Employee not found.");
  if (!employee.isSales) throw new AppError("This employee is not marked as a sales employee.");
  const [year, month] = input.month.split("-").map(Number) as [number, number];

  const before = salesMonthId ? await db.salesMonth.findUnique({ where: { id: salesMonthId } }) : null;
  if (salesMonthId && (!before || before.employeeId !== employeeId)) throw new NotFoundError("Sales month not found.");
  if (before) await assertMonthOpen(before.year, before.month);
  await assertMonthOpen(year, month);

  const clash = await db.salesMonth.findUnique({ where: { employeeId_year_month: { employeeId, year, month } }, select: { id: true } });
  if (clash && clash.id !== salesMonthId) throw new AppError("That month already has sales figures. Edit that row instead.");

  const data = { year, month, target: input.target, achieved: input.achieved, commission: input.commission, note: input.note ?? null, updatedById: actor.userId };
  return db.$transaction(async (tx) => {
    const after = before
      ? await tx.salesMonth.update({ where: { id: before.id }, data })
      : await tx.salesMonth.create({ data: { employeeId, ...data } });
    await recordAudit({ actor, action: before ? "sales.update" : "sales.create", entityType: "Employee", entityId: employeeId, before: before ?? undefined, after }, tx);
    return after;
  });
}

export async function deleteSalesMonth(actor: Actor, employeeId: string, salesMonthId: string) {
  assertPermission(actor, "salary.manage", "all");
  const before = await db.salesMonth.findUnique({ where: { id: salesMonthId } });
  if (!before || before.employeeId !== employeeId) throw new NotFoundError("Sales month not found.");
  await assertMonthOpen(before.year, before.month);
  await db.$transaction(async (tx) => {
    await tx.salesMonth.delete({ where: { id: salesMonthId } });
    await recordAudit({ actor, action: "sales.delete", entityType: "Employee", entityId: employeeId, before }, tx);
  });
}
