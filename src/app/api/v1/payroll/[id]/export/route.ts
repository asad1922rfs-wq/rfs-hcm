import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { can, getActor } from "@/server/auth/session";
import { db } from "@/server/db";
import { decryptField } from "@/server/crypto";
import { recordAudit } from "@/server/audit";
import { monthName } from "@/server/services/payroll";
import { asStringArray } from "@/server/json-fields";

export const dynamic = "force-dynamic";

/** Payroll sheet for Finance / bank transfer. Bank columns only for users allowed to see all bank details. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(actor, "payroll.read", "all")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;

  const run = await db.payrollRun.findUnique({
    where: { id },
    include: { items: { orderBy: { fullName: "asc" }, include: { employee: { select: { bankAccount: true } } } } },
  });
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const withBank = can(actor, "bank.read", "all");

  const wb = new ExcelJS.Workbook();
  wb.creator = "RFS HCM";
  const ws = wb.addWorksheet(monthName(run.year, run.month), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Employee Code", key: "code", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Department", key: "dept", width: 18 },
    { header: "Designation", key: "desig", width: 26 },
    { header: "Monthly Salary", key: "gross", width: 14 },
    { header: "Employed Days", key: "employed", width: 10 },
    { header: "Present", key: "present", width: 9 },
    { header: "Absent", key: "absent", width: 9 },
    { header: "Late", key: "late", width: 8 },
    { header: "Missing Punch", key: "missing", width: 10 },
    { header: "Late Deduction Days", key: "lateDays", width: 10 },
    { header: "Earnings", key: "earnings", width: 13 },
    { header: "Deductions", key: "deductions", width: 13 },
    { header: "Net Pay", key: "net", width: 13 },
    ...(withBank
      ? [
          { header: "Bank", key: "bank", width: 18 },
          { header: "Account Title", key: "title", width: 24 },
          { header: "Account Number", key: "account", width: 22 },
          { header: "IBAN", key: "iban", width: 28 },
        ]
      : []),
    { header: "Warnings", key: "warnings", width: 60 },
  ];
  for (const i of run.items) {
    const b = i.employee?.bankAccount;
    ws.addRow({
      code: i.employeeCode, name: i.fullName, dept: i.department, desig: i.designation, gross: Number(i.grossSalary),
      employed: i.employedDays, present: i.presentDays, absent: i.absentDays, late: i.lateCount, missing: i.missingPunchCount,
      lateDays: i.lateDeductionDays, earnings: Number(i.earnings), deductions: Number(i.deductions), net: Number(i.netPay),
      ...(withBank && b ? { bank: b.bankName, title: b.accountTitle, account: decryptField(b.accountNumberEnc), iban: b.ibanEnc ? decryptField(b.ibanEnc) : "" } : {}),
      warnings: asStringArray(i.warnings).join("; "),
    });
  }
  const total = ws.addRow({ name: "TOTAL", earnings: { formula: `SUM(L2:L${run.items.length + 1})` }, deductions: { formula: `SUM(M2:M${run.items.length + 1})` }, net: { formula: `SUM(N2:N${run.items.length + 1})` } });
  total.font = { bold: true };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  for (const key of ["gross", "earnings", "deductions", "net"]) ws.getColumn(key).numFmt = "#,##0";

  await recordAudit({ actor, action: "payroll.export", entityType: "PayrollRun", entityId: run.id, after: { month: monthName(run.year, run.month), withBankDetails: withBank } });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `rfs-payroll-${run.year}-${String(run.month).padStart(2, "0")}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
