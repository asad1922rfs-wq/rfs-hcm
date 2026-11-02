import "server-only";
import { db } from "@/server/db";

/** True when attendance for this date belongs to a payroll that is approved or paid (and so must not change). */
export async function isPayrollLockedFor(date: string): Promise<boolean> {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const run = await db.payrollRun.findUnique({ where: { year_month: { year: y, month: m } }, select: { status: true } });
  return !!run && (run.status === "APPROVED" || run.status === "PAID");
}

/** "YYYY-MM" of every month whose payroll is approved or paid. */
export async function lockedPayrollMonths(): Promise<Set<string>> {
  const runs = await db.payrollRun.findMany({ where: { status: { in: ["APPROVED", "PAID"] } }, select: { year: true, month: true } });
  return new Set(runs.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`));
}
