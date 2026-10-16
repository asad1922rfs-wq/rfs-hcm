import "server-only";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { parseSalaryRows, type SalaryImportRow } from "@/core/payroll/salary-import";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

const MAX_BYTES = 5 * 1024 * 1024;

/** Salary upload template, pre-filled with every active employee and their current salary (if any). */
export async function buildSalaryTemplate(actor: Actor): Promise<Buffer> {
  assertPermission(actor, "salary.manage", "all");
  const today = todayInPKT();
  const employees = await db.employee.findMany({
    where: { status: "ACTIVE" },
    orderBy: { employeeCode: "asc" },
    select: {
      employeeCode: true, fullName: true, joiningDate: true,
      department: { select: { name: true } }, designation: { select: { title: true } },
      salaryStructures: { where: { effectiveFrom: { lte: today } }, orderBy: { effectiveFrom: "desc" }, take: 1, include: { allowances: true } },
    },
  });
  const allowanceNames = [...new Set(employees.flatMap((e) => e.salaryStructures[0]?.allowances.map((a) => a.name) ?? []))].sort();

  const wb = new ExcelJS.Workbook();
  wb.creator = "RFS HCM";
  const ws = wb.addWorksheet("Salaries", { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  ws.columns = [
    { header: "Employee Code", key: "code", width: 14 },
    { header: "Name", key: "name", width: 30 },
    { header: "Department", key: "dept", width: 20 },
    { header: "Designation", key: "desig", width: 28 },
    { header: "Joining Date", key: "joining", width: 13 },
    { header: "Effective From", key: "eff", width: 14 },
    { header: "Basic Salary", key: "basic", width: 14 },
    ...allowanceNames.map((n) => ({ header: `Allowance: ${n}`, key: `a:${n}`, width: 16 })),
  ];
  for (const e of employees) {
    const s = e.salaryStructures[0];
    ws.addRow({
      code: e.employeeCode,
      name: e.fullName,
      dept: e.department?.name ?? "",
      desig: e.designation?.title ?? "",
      joining: toDateOnlyString(e.joiningDate),
      eff: "",
      basic: s ? Number(s.basicSalary) : null,
      ...Object.fromEntries(allowanceNames.map((n) => [`a:${n}`, s?.allowances.find((a) => a.name === n) ? Number(s.allowances.find((a) => a.name === n)!.amount) : null])),
    });
  }
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  ws.getColumn("basic").numFmt = "#,##0";

  const help = wb.addWorksheet("How to fill");
  [
    "RFS HCM salary upload",
    "",
    "• Enter the monthly Basic Salary in PKR for each employee. Rows left empty are ignored.",
    "• Effective From: leave empty to use the joining date for an employee's first salary; for a revision enter the date it applies from (e.g. 2026-11-01).",
    "• Allowances: add one column per allowance type, titled exactly “Allowance: <name>” (e.g. “Allowance: Fuel”, “Allowance: Mobile”). Enter the fixed monthly amount; leave empty or 0 if not paid.",
    "• Do not change the Employee Code column. Name, Department, Designation and Joining Date are for reference only.",
    "• Upload in RFS HCM → Employees → Import salaries. A preview is shown before anything is saved.",
  ].forEach((t) => help.addRow([t]));
  help.getColumn(1).width = 140;
  help.getRow(1).font = { bold: true, size: 14 };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result ?? "");
    return "";
  }
  return String(v);
}

export type SalaryPreviewRow = SalaryImportRow & { fullName: string | null; action: "create" | "replace" | "skip"; previousBasic: number | null };

async function analyse(actor: Actor, file: File) {
  assertPermission(actor, "salary.manage", "all");
  if (file.size === 0 || file.size > MAX_BYTES) throw new AppError("Upload an .xlsx file under 5 MB.");
  if (!/\.xlsx$/i.test(file.name)) throw new AppError("Upload the .xlsx salary template.");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError("This file could not be read as an Excel workbook.");
  }
  const ws = wb.getWorksheet("Salaries") ?? wb.worksheets[0];
  if (!ws) throw new AppError("The workbook has no sheets.");
  const width = ws.columnCount;
  const toRow = (r: number) => Array.from({ length: width }, (_, i) => cellText(ws.getRow(r).getCell(i + 1).value));
  const rows: string[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) rows.push(toRow(r));

  let parsed: SalaryImportRow[];
  try {
    parsed = parseSalaryRows(toRow(1), rows, todayInPKT());
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : "Unrecognised sheet.");
  }

  const employees = await db.employee.findMany({
    where: { employeeCode: { in: parsed.map((r) => r.employeeCode).filter(Boolean) } },
    select: { id: true, employeeCode: true, fullName: true, joiningDate: true, status: true, salaryStructures: { select: { effectiveFrom: true, basicSalary: true }, orderBy: { effectiveFrom: "desc" } } },
  });
  const byCode = new Map(employees.map((e) => [e.employeeCode.toUpperCase(), e]));

  const preview: SalaryPreviewRow[] = parsed.map((r) => {
    const e = byCode.get(r.employeeCode);
    if (r.errors.length === 0 && !e) r.errors.push(`No employee with code ${r.employeeCode}`);
    if (e && r.errors.length === 0) {
      if (!r.effectiveFrom) {
        if (e.salaryStructures.length) r.errors.push("Already has a salary — enter an Effective From date for this revision");
        else r.effectiveFrom = toDateOnlyString(e.joiningDate);
      }
      if (r.effectiveFrom && r.effectiveFrom < toDateOnlyString(e.joiningDate)) r.errors.push("Effective date is before the joining date");
      if (e.status !== "ACTIVE") r.warnings.push(`Employee is ${e.status.toLowerCase()}`);
    }
    const same = e?.salaryStructures.find((s) => r.effectiveFrom && toDateOnlyString(s.effectiveFrom) === r.effectiveFrom);
    return {
      ...r,
      fullName: e?.fullName ?? null,
      action: r.errors.length ? "skip" : same ? "replace" : "create",
      previousBasic: e?.salaryStructures[0] ? Number(e.salaryStructures[0].basicSalary) : null,
    };
  });
  return { preview, byCode };
}

export async function previewSalaryImport(actor: Actor, file: File) {
  return (await analyse(actor, file)).preview;
}

export async function commitSalaryImport(actor: Actor, file: File) {
  const { preview, byCode } = await analyse(actor, file);
  let saved = 0;
  for (const r of preview.filter((p) => p.action !== "skip")) {
    const employeeId = byCode.get(r.employeeCode)!.id;
    const effectiveFrom = new Date(`${r.effectiveFrom}T00:00:00Z`);
    await db.$transaction(async (tx) => {
      const existing = await tx.salaryStructure.findUnique({ where: { employeeId_effectiveFrom: { employeeId, effectiveFrom } } });
      if (existing) {
        await tx.salaryAllowance.deleteMany({ where: { salaryStructureId: existing.id } });
        await tx.salaryStructure.update({
          where: { id: existing.id },
          data: { basicSalary: new Prisma.Decimal(r.basicSalary!), note: "Salary import", createdById: actor.userId, allowances: { create: r.allowances } },
        });
      } else {
        await tx.salaryStructure.create({
          data: { employeeId, effectiveFrom, basicSalary: new Prisma.Decimal(r.basicSalary!), note: "Salary import", createdById: actor.userId, allowances: { create: r.allowances } },
        });
      }
      await recordAudit({ actor, action: "salary.import", entityType: "Employee", entityId: employeeId, after: { effectiveFrom: r.effectiveFrom, basicSalary: r.basicSalary, allowances: r.allowances } }, tx);
    });
    saved++;
  }
  return { saved, skipped: preview.length - saved, preview };
}
