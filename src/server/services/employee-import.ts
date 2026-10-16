import "server-only";
import ExcelJS from "exceljs";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { encryptField } from "@/server/crypto";
import { AppError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { recomputeAttendance } from "@/server/services/attendance";
import { parseFlowHcmRows, type ImportRow } from "@/core/employees/flowhcm-import";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

const MAX_BYTES = 5 * 1024 * 1024;

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result ?? "");
    if ("error" in v) return "";
  }
  return String(v);
}

async function readWorkbook(file: File): Promise<{ header: string[]; rows: string[][] }> {
  if (file.size === 0) throw new AppError("The file is empty.");
  if (file.size > MAX_BYTES) throw new AppError("The file is larger than 5 MB.");
  if (!/\.xlsx$/i.test(file.name)) throw new AppError("Upload the .xlsx file exported from FlowHCM (Excel 2007+ format).");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ExcelJS.Buffer);
  } catch {
    throw new AppError("This file could not be read as an Excel workbook.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError("The workbook has no sheets.");
  const width = ws.columnCount;
  const toRow = (r: number) => Array.from({ length: width }, (_, i) => cellText(ws.getRow(r).getCell(i + 1).value));
  const header = toRow(1);
  if (!header.some((h) => /employeecode/i.test(h)) || !header.some((h) => /firstname/i.test(h))) {
    throw new AppError("This does not look like the FlowHCM employee template (EmployeeCode / FirstName columns not found).");
  }
  const rows: string[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) rows.push(toRow(r));
  return { header, rows };
}

export type PreviewRow = Pick<
  ImportRow,
  "rowNumber" | "employeeCode" | "deviceUserId" | "fullName" | "department" | "designation" | "employmentType" | "status" | "joiningDate" | "exitDate" | "warnings" | "errors"
> & { action: "create" | "update" | "skip"; punchCount: number; lastPunch: string | null; hasBank: boolean };

async function analyse(actor: Actor, file: File) {
  assertPermission(actor, "employee.manage", "all");
  const { header, rows } = await readWorkbook(file);
  const parsed = parseFlowHcmRows(header, rows, todayInPKT());
  if (parsed.length === 0) throw new AppError("No employee rows found in the sheet.");

  const existing = await db.employee.findMany({ select: { id: true, employeeCode: true, email: true, deviceUserId: true } });
  const byCode = new Map(existing.map((e) => [e.employeeCode.toUpperCase(), e]));
  const canBank = can(actor, "bank.manage", "all");

  const punchStats = await db.rawPunch.groupBy({
    by: ["deviceUserId"],
    where: { deviceUserId: { in: parsed.map((r) => r.deviceUserId).filter((v): v is string => !!v) } },
    _count: { _all: true },
    _max: { deviceLocal: true },
  });
  const stats = new Map(punchStats.map((s) => [s.deviceUserId, s]));

  for (const r of parsed) {
    const self = byCode.get(r.employeeCode);
    const emailOwner = r.email ? existing.find((e) => e.email === r.email) : undefined;
    if (emailOwner && emailOwner.id !== self?.id) {
      r.warnings.push(`Email already belongs to employee ${emailOwner.employeeCode} — left empty`);
      r.email = null;
    }
    const punchOwner = r.deviceUserId ? existing.find((e) => e.deviceUserId === r.deviceUserId) : undefined;
    if (punchOwner && punchOwner.id !== self?.id) {
      r.warnings.push(`Punch code already linked to employee ${punchOwner.employeeCode} — not linked`);
      r.deviceUserId = null;
    }
    if (r.reportsToCode && !parsed.some((p) => p.employeeCode === r.reportsToCode) && !byCode.has(r.reportsToCode)) {
      r.warnings.push(`Reports-to "${r.reportsToCode}" not found — manager left empty`);
      r.reportsToCode = null;
    }
    if (r.bank && !canBank) {
      r.warnings.push("Bank details not imported — your role cannot manage bank details");
      r.bank = null;
    }
    const s = r.deviceUserId ? stats.get(r.deviceUserId) : undefined;
    if (r.status !== "ACTIVE" && s?._max.deviceLocal && r.exitDate && s._max.deviceLocal.slice(0, 10) > r.exitDate) {
      r.warnings.push(`Last machine punch was ${s._max.deviceLocal.slice(0, 10)}, after the exit date — confirm the exit date`);
    }
    if (r.status === "ACTIVE" && r.deviceUserId && !s) r.warnings.push("No punches on the machine for this punch code yet");
  }

  const preview: PreviewRow[] = parsed.map((r) => {
    const s = r.deviceUserId ? stats.get(r.deviceUserId) : undefined;
    return {
      rowNumber: r.rowNumber, employeeCode: r.employeeCode, deviceUserId: r.deviceUserId, fullName: r.fullName,
      department: r.department, designation: r.designation, employmentType: r.employmentType, status: r.status,
      joiningDate: r.joiningDate, exitDate: r.exitDate, warnings: r.warnings, errors: r.errors,
      action: r.errors.length ? "skip" : byCode.has(r.employeeCode) ? "update" : "create",
      punchCount: s?._count._all ?? 0,
      lastPunch: s?._max.deviceLocal?.slice(0, 10) ?? null,
      hasBank: !!r.bank,
    };
  });
  return { parsed, preview, byCode };
}

export async function previewEmployeeImport(actor: Actor, file: File) {
  const { preview } = await analyse(actor, file);
  return preview;
}

export async function commitEmployeeImport(actor: Actor, file: File) {
  const { parsed, preview, byCode } = await analyse(actor, file);
  const rows = parsed.filter((r) => r.errors.length === 0);

  const defaultShift = await db.shift.findFirst({ where: { isDefault: true, isActive: true } });
  const deptIds = new Map<string, string>();
  const desigIds = new Map<string, string>();
  for (const name of new Set(rows.map((r) => r.department).filter((v): v is string => !!v))) {
    const d = await db.department.upsert({ where: { name }, create: { name }, update: {} });
    deptIds.set(name, d.id);
  }
  for (const title of new Set(rows.map((r) => r.designation).filter((v): v is string => !!v))) {
    const d = await db.designation.upsert({ where: { title }, create: { title }, update: {} });
    desigIds.set(title, d.id);
  }

  const idByCode = new Map<string, string>([...byCode.entries()].map(([code, e]) => [code, e.id]));
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = {
      fullName: r.fullName,
      fatherName: r.fatherName,
      email: r.email,
      phone: r.phone,
      gender: r.gender,
      maritalStatus: r.maritalStatus,
      dateOfBirth: r.dateOfBirth ? new Date(`${r.dateOfBirth}T00:00:00Z`) : null,
      cnicEnc: r.cnic ? encryptField(r.cnic) : null,
      address: r.address,
      joiningDate: new Date(`${r.joiningDate}T00:00:00Z`),
      exitDate: r.exitDate ? new Date(`${r.exitDate}T00:00:00Z`) : null,
      employmentType: r.employmentType,
      status: r.status,
      grade: r.grade,
      deviceUserId: r.deviceUserId,
      departmentId: r.department ? deptIds.get(r.department)! : null,
      designationId: r.designation ? desigIds.get(r.designation)! : null,
    };
    const existingId = idByCode.get(r.employeeCode);
    const employee = existingId
      ? await db.employee.update({ where: { id: existingId }, data })
      : await db.employee.create({ data: { ...data, employeeCode: r.employeeCode, shiftId: defaultShift?.id ?? null } });
    if (existingId) updated++;
    else created++;
    idByCode.set(r.employeeCode, employee.id);

    if (r.emergencyContacts.length) {
      await db.emergencyContact.deleteMany({ where: { employeeId: employee.id } });
      await db.emergencyContact.createMany({ data: r.emergencyContacts.map((c) => ({ ...c, employeeId: employee.id })) });
    }
    if (r.bank) {
      const bank = {
        bankName: r.bank.bankName,
        accountTitle: r.bank.accountTitle,
        branch: r.bank.branch,
        accountNumberEnc: encryptField(r.bank.accountNumber),
        ibanEnc: r.bank.iban ? encryptField(r.bank.iban) : null,
      };
      await db.bankAccount.upsert({ where: { employeeId: employee.id }, create: { employeeId: employee.id, ...bank }, update: bank });
    }
  }

  // Reporting lines, once every employee exists
  for (const r of rows) {
    const managerId = r.reportsToCode ? idByCode.get(r.reportsToCode) ?? null : null;
    await db.employee.update({ where: { id: idByCode.get(r.employeeCode)! }, data: { managerId } });
  }

  // Attach machine punches and calculate attendance history
  const importedIds = rows.map((r) => idByCode.get(r.employeeCode)!);
  for (const r of rows) {
    if (r.deviceUserId) await db.rawPunch.updateMany({ where: { deviceUserId: r.deviceUserId }, data: { employeeId: idByCode.get(r.employeeCode)! } });
  }
  const earliest = await db.rawPunch.findFirst({ where: { employeeId: { in: importedIds } }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } });
  if (earliest) {
    await recomputeAttendance({ employeeIds: importedIds, from: toDateOnlyString(earliest.punchedAt), to: toDateOnlyString(todayInPKT()) });
  }

  const skipped = preview.filter((p) => p.action === "skip").length;
  await recordAudit({
    actor,
    action: "employee.import",
    entityType: "Employee",
    after: { file: file.name, created, updated, skipped, warnings: preview.reduce((n, p) => n + p.warnings.length, 0) },
  });
  return { created, updated, skipped, preview };
}
