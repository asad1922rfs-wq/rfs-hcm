import "server-only";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { decryptField, maskValue } from "@/server/crypto";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { can, type Actor } from "@/server/auth/session";
import { monthName } from "@/server/services/payroll";
import { renderPayslips, type PayslipData } from "@/server/pdf/payslip";
import { readCompanyLogo } from "@/server/services/branding";
import type { PayLine } from "@/core/payroll/calculate";
import { payslipLineLabel } from "@/core/payroll/payslip-labels";
import { canAccessEmployee } from "@/server/auth/scope";
import { estimatePayslip } from "@/server/services/pay-estimate";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

const itemInclude = {
  run: { select: { id: true, year: true, month: true, status: true, paidAt: true } },
  employee: { select: { cnicEnc: true, joiningDate: true } },
} as const;

type ItemWithRun = Awaited<ReturnType<typeof loadItems>>[number];

function loadItems(where: { id?: string; runId?: string }) {
  return db.payrollItem.findMany({ where, include: itemInclude, orderBy: { fullName: "asc" } });
}

/** Who printed it: the signed-in user's employee name, else their email. */
async function printedBy(actor: Actor): Promise<string> {
  const e = actor.employeeId ? await db.employee.findUnique({ where: { id: actor.employeeId }, select: { fullName: true } }) : null;
  return e?.fullName ?? actor.email ?? actor.displayName;
}

/** Employees see their own full CNIC; anyone else only if they may manage employee records (as on the profile). */
function cnicFor(actor: Actor, employeeId: string | null, cnicEnc: string | null | undefined): string | null {
  if (!cnicEnc) return null;
  const cnic = decryptField(cnicEnc);
  const reveal = (!!employeeId && actor.employeeId === employeeId) || can(actor, "employee.manage", "all");
  return reveal ? cnic : maskValue(cnic);
}

function splitLines(lines: PayLine[]) {
  const view = (kind: PayLine["kind"]) => lines.filter((l) => l.kind === kind).map((l) => ({ label: payslipLineLabel(l), amount: l.amount }));
  return { earnings: view("EARNING"), deductions: view("DEDUCTION") };
}

type PrintContext = { actor: Actor; company: PayslipData["company"]; printedBy: string; printDate: Date };

async function printContext(actor: Actor): Promise<PrintContext> {
  const [company, by] = await Promise.all([companyHeader(), printedBy(actor)]);
  return { actor, company, printedBy: by, printDate: new Date() };
}

function toPayslip(item: ItemWithRun, ctx: PrintContext): PayslipData {
  return {
    kind: "final",
    company: ctx.company,
    period: monthName(item.run.year, item.run.month),
    status: item.run.status === "PAID" ? "PAID" : "APPROVED",
    paidAt: item.run.paidAt,
    printDate: ctx.printDate,
    printedBy: ctx.printedBy,
    employee: {
      code: item.employeeCode,
      name: item.fullName,
      department: item.department,
      designation: item.designation,
      cnic: cnicFor(ctx.actor, item.employeeId, item.employee?.cnicEnc),
      joiningDate: item.employee ? toDateOnlyString(item.employee.joiningDate) : null,
    },
    monthlySalary: Number(item.grossSalary),
    ...splitLines(item.lines as PayLine[]),
    totalEarnings: Number(item.earnings),
    totalDeductions: Number(item.deductions),
    netPay: Number(item.netPay),
  };
}

async function companyHeader(): Promise<PayslipData["company"]> {
  const c = await db.company.findFirst();
  // PDFs can embed PNG and JPEG only.
  const logo = await readCompanyLogo();
  const logoData = logo && (logo.mime === "image/png" || logo.mime === "image/jpeg") ? `data:${logo.mime};base64,${logo.data.toString("base64")}` : null;
  return { legalName: c?.legalName ?? "Company", address: c?.address ?? null, phone: c?.phone ?? null, email: c?.email ?? null, ntn: c?.ntn ?? null, logo: logoData };
}

const isFinal = (status: string) => status === "APPROVED" || status === "PAID";

/** One employee's payslip. Employees can download their own; HR/Finance anyone's. Only for approved payroll. */
export async function payslipPdf(actor: Actor, itemId: string) {
  const [item] = await loadItems({ id: itemId });
  if (!item) throw new NotFoundError("Payslip not found.");
  const own = !!actor.employeeId && item.employeeId === actor.employeeId && can(actor, "payslip.read", "self");
  if (!own && !can(actor, "payslip.read", "all")) throw new ForbiddenError();
  if (!isFinal(item.run.status)) throw new AppError("Payslips are issued once payroll is approved.");
  const pdf = await renderPayslips([toPayslip(item, await printContext(actor))]);
  if (!own) await recordAudit({ actor, action: "payslip.download", entityType: "Employee", entityId: item.employeeId, after: { period: monthName(item.run.year, item.run.month) } });
  return { pdf, filename: `payslip-${item.employeeCode}-${item.run.year}-${String(item.run.month).padStart(2, "0")}.pdf` };
}

/** All payslips of an approved payroll in one PDF (HR / Finance). */
export async function bulkPayslipPdf(actor: Actor, runId: string) {
  if (!can(actor, "payslip.read", "all")) throw new ForbiddenError();
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError("Payroll not found.");
  if (!isFinal(run.status)) throw new AppError("Payslips are issued once payroll is approved.");
  const items = await loadItems({ runId });
  const ctx = await printContext(actor);
  const pdf = await renderPayslips(items.map((i) => toPayslip(i, ctx)));
  await recordAudit({ actor, action: "payslip.bulk_download", entityType: "PayrollRun", entityId: runId, after: { period: monthName(run.year, run.month), count: items.length } });
  return { pdf, filename: `payslips-${run.year}-${String(run.month).padStart(2, "0")}.pdf` };
}

/**
 * The month's expected payslip: the same estimate the ESS dashboard shows, in the payslip layout.
 * For the employee themself, or anyone who may read their salary. Once the month's payroll is approved,
 * the real payslip is served instead.
 */
export async function expectedPayslipPdf(actor: Actor, opts: { employeeId?: string | null; period?: "current" | "previous" }) {
  const employeeId = opts.employeeId || actor.employeeId;
  if (!employeeId) throw new NotFoundError("Your account is not linked to an employee record.");
  const own = employeeId === actor.employeeId;
  if (!own && !(await canAccessEmployee(actor, "salary.read", employeeId))) throw new ForbiddenError();

  const today = todayInPKT();
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (opts.period === "previous" ? 1 : 0), 1));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const period = `${year}-${String(month).padStart(2, "0")}`;

  const approved = await db.payrollItem.findFirst({ where: { employeeId, run: { year, month, status: { in: ["APPROVED", "PAID"] } } }, select: { id: true } });
  if (approved) return payslipPdf(actor, approved.id);

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { employeeCode: true, fullName: true, cnicEnc: true, joiningDate: true, department: { select: { name: true } }, designation: { select: { title: true } } },
  });
  if (!employee) throw new NotFoundError("Employee not found.");
  const estimate = await estimatePayslip(employeeId, year, month);
  if (!estimate) throw new AppError(`No expected payslip for ${monthName(year, month)}: no salary is set, or the month was paid through the previous software.`);

  const ctx = await printContext(actor);
  const data: PayslipData = {
    kind: "expected",
    company: ctx.company,
    period: monthName(year, month),
    status: "ESTIMATE",
    paidAt: null,
    printDate: ctx.printDate,
    printedBy: ctx.printedBy,
    employee: {
      code: employee.employeeCode,
      name: employee.fullName,
      department: employee.department?.name ?? null,
      designation: employee.designation?.title ?? null,
      cnic: cnicFor(actor, employeeId, employee.cnicEnc),
      joiningDate: toDateOnlyString(employee.joiningDate),
    },
    monthlySalary: estimate.gross,
    ...splitLines(estimate.lines),
    totalEarnings: estimate.earnings,
    totalDeductions: estimate.deductions,
    netPay: estimate.netPay,
  };
  const pdf = await renderPayslips([data]);
  if (!own) await recordAudit({ actor, action: "payslip.expected_download", entityType: "Employee", entityId: employeeId, after: { period: monthName(year, month) } });
  return { pdf, filename: `rfs-expected-payslip-${employee.employeeCode}-${period}.pdf` };
}
