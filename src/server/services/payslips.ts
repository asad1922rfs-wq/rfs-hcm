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

const itemInclude = {
  run: { select: { id: true, year: true, month: true, status: true, paidAt: true } },
  employee: { select: { cnicEnc: true, bankAccount: { select: { bankName: true, accountNumberEnc: true } } } },
} as const;

type ItemWithRun = Awaited<ReturnType<typeof loadItems>>[number];

function loadItems(where: { id?: string; runId?: string }) {
  return db.payrollItem.findMany({ where, include: itemInclude, orderBy: { fullName: "asc" } });
}

async function toPayslip(item: ItemWithRun, company: PayslipData["company"]): Promise<PayslipData> {
  const lines = item.lines as PayLine[];
  const bank = item.employee?.bankAccount;
  return {
    company,
    period: monthName(item.run.year, item.run.month),
    status: item.run.status === "PAID" ? "PAID" : "APPROVED",
    paidAt: item.run.paidAt,
    generatedAt: new Date(),
    employee: {
      code: item.employeeCode,
      name: item.fullName,
      department: item.department,
      designation: item.designation,
      cnicMasked: item.employee?.cnicEnc ? maskValue(decryptField(item.employee.cnicEnc)) : null,
      bank: bank ? `${bank.bankName} · ${maskValue(decryptField(bank.accountNumberEnc))}` : null,
    },
    attendance: {
      daysInMonth: item.daysInMonth, employedDays: item.employedDays, presentDays: item.presentDays, absentDays: item.absentDays,
      lateCount: item.lateCount, missingPunchCount: item.missingPunchCount, lateDeductionDays: item.lateDeductionDays,
    },
    perDayRate: Number(item.perDayRate),
    earnings: lines.filter((l) => l.kind === "EARNING").map((l) => ({ label: l.label, amount: l.amount })),
    deductions: lines.filter((l) => l.kind === "DEDUCTION").map((l) => ({ label: l.label, amount: l.amount })),
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
  const pdf = await renderPayslips([await toPayslip(item, await companyHeader())]);
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
  const company = await companyHeader();
  const pdf = await renderPayslips(await Promise.all(items.map((i) => toPayslip(i, company))));
  await recordAudit({ actor, action: "payslip.bulk_download", entityType: "PayrollRun", entityId: runId, after: { period: monthName(run.year, run.month), count: items.length } });
  return { pdf, filename: `payslips-${run.year}-${String(run.month).padStart(2, "0")}.pdf` };
}
