import "server-only";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { decryptField, maskValue } from "@/server/crypto";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { scopedEmployeeWhere } from "@/server/auth/scope";
import { localTime } from "@/server/services/attendance-edit";
import { holidaysBetween } from "@/server/services/holidays";
import { leaveBalances } from "@/server/services/leave";
import { approvedHalfDayDates } from "@/server/services/attendance-requests";
import { monthName } from "@/server/services/payroll";
import { addDaysIso } from "@/core/attendance/engine";
import { DAY_STATUSES } from "@/core/attendance/day-status";
import { hoursMinutes, monthRange, summariseAttendance, type AttendanceSummary } from "@/core/reports/attendance-summary";
import { formatDate, formatDateTime, to12h } from "@/lib/format";
import { toDateOnlyString } from "@/lib/dates";
import { weekendOf } from "@/server/json-fields";

// Month-end reports for HR and Finance: row builders (also used for on-screen previews) and Excel writers.
// Every builder takes the actor and applies their permission scope itself — filters from the request only narrow it.

export const MAX_DAILY_RANGE_DAYS = 62;

const d0 = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Employees in scope who were employed at some point in [from, to]. */
async function employeesFor(actor: Actor, permission: "report.read", from: string, to: string, filter: { departmentId?: string; employeeId?: string }) {
  const scope = await scopedEmployeeWhere(actor, permission);
  return db.employee.findMany({
    where: {
      AND: [
        scope,
        filter.departmentId ? { departmentId: filter.departmentId } : {},
        filter.employeeId ? { id: filter.employeeId } : {},
        { joiningDate: { lte: d0(to) } },
        { OR: [{ exitDate: null }, { exitDate: { gte: d0(from) } }] },
        { OR: [{ status: "ACTIVE" }, { exitDate: { not: null } }] },
      ],
    },
    orderBy: { fullName: "asc" },
    select: {
      id: true, employeeCode: true, fullName: true, joiningDate: true, exitDate: true,
      department: { select: { name: true } }, designation: { select: { title: true } },
    },
  });
}

// ───────────── Attendance summary ─────────────

export type AttendanceSummaryRow = AttendanceSummary & {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
};

export async function attendanceSummaryRows(actor: Actor, year: number, month: number, departmentId?: string): Promise<AttendanceSummaryRow[]> {
  assertPermission(actor, "report.read", "team");
  const { from, to } = monthRange(year, month);
  const employees = await employeesFor(actor, "report.read", from, to, { departmentId });
  const days = employees.length
    ? await db.attendanceDay.findMany({
        where: { employeeId: { in: employees.map((e) => e.id) }, workDate: { gte: d0(from), lte: d0(to) } },
        select: { employeeId: true, workDate: true, status: true, workedMinutes: true, lateMinutes: true },
      })
    : [];
  const byEmployee = new Map<string, typeof days>();
  for (const d of days) (byEmployee.get(d.employeeId) ?? byEmployee.set(d.employeeId, []).get(d.employeeId)!).push(d);
  const halfDays = await approvedHalfDayDates(employees.map((e) => e.id), from, to);

  return employees.map((e) => ({
    employeeId: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    department: e.department?.name ?? null,
    designation: e.designation?.title ?? null,
    ...summariseAttendance((byEmployee.get(e.id) ?? []).map((d) => ({ ...d, workDate: toDateOnlyString(d.workDate) })), from, to, halfDays.get(e.id)),
  }));
}

// ───────────── Daily attendance detail ─────────────

export type DailyDetailRow = {
  date: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  status: string;
  checkIn: string;
  checkOut: string;
  worked: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
};

/** "2:05 PM", or "12:30 AM (next day)" for a check-out after midnight. */
function clock(instant: Date | null, workDate: string): string {
  const t = localTime(instant, workDate);
  return t ? `${to12h(t.time)}${t.nextDay ? " (next day)" : ""}` : "";
}

export async function dailyDetailRows(actor: Actor, from: string, to: string, filter: { departmentId?: string; employeeId?: string }): Promise<DailyDetailRow[]> {
  assertPermission(actor, "report.read", "team");
  if (to < from) throw new AppError("The end date is before the start date.");
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (span > MAX_DAILY_RANGE_DAYS) throw new AppError(`Choose at most ${MAX_DAILY_RANGE_DAYS} days.`);

  const employees = await employeesFor(actor, "report.read", from, to, filter);
  const [days, company, holidays] = await Promise.all([
    employees.length
      ? db.attendanceDay.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, workDate: { gte: d0(from), lte: d0(to) } } })
      : [],
    db.company.findFirst({ select: { weekendDays: true } }),
    holidaysBetween(from, to),
  ]);
  const weekend = weekendOf(company);
  const dayMap = new Map(days.map((d) => [`${d.employeeId}|${toDateOnlyString(d.workDate)}`, d]));

  const rows: DailyDetailRow[] = [];
  for (const e of employees) {
    // Only the days the employee was employed.
    const joined = toDateOnlyString(e.joiningDate);
    const left = e.exitDate ? toDateOnlyString(e.exitDate) : null;
    for (let date = joined > from ? joined : from; date <= to && (!left || date <= left); date = addDaysIso(date, 1)) {
      const d = dayMap.get(`${e.id}|${date}`);
      const holiday = holidays.get(date);
      const off = weekend.includes(d0(date).getUTCDay());
      rows.push({
        date,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        department: e.department?.name ?? null,
        status: d ? DAY_STATUSES[d.status].label : holiday ? `Holiday — ${holiday}` : off ? DAY_STATUSES.OFF.label : "No record",
        checkIn: clock(d?.firstIn ?? null, date),
        checkOut: clock(d?.lastOut ?? null, date),
        worked: hoursMinutes(d?.workedMinutes ?? null),
        lateMinutes: d?.lateMinutes ?? 0,
        earlyLeaveMinutes: d?.earlyLeaveMinutes ?? 0,
      });
    }
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.fullName.localeCompare(b.fullName));
}

// ───────────── Leave ─────────────

export type LeaveReportRow = {
  employeeCode: string;
  fullName: string;
  department: string | null;
  leaveType: string;
  isPaid: boolean;
  entitlement: number | null;
  approvedDays: number;
  pendingDays: number;
  pendingRequests: number;
  remaining: number | null;
};

export async function leaveReportRows(actor: Actor, year: number, departmentId?: string): Promise<LeaveReportRow[]> {
  assertPermission(actor, "report.read", "team");
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const employees = await employeesFor(actor, "report.read", from, to, { departmentId });
  const ids = employees.map((e) => e.id);
  const pending = ids.length
    ? await db.leaveRequest.groupBy({
        by: ["employeeId", "leaveTypeId"],
        where: { employeeId: { in: ids }, status: "PENDING", startDate: { lte: d0(to) }, endDate: { gte: d0(from) } },
        _count: { _all: true },
      })
    : [];
  const pendingCount = new Map(pending.map((p) => [`${p.employeeId}|${p.leaveTypeId}`, p._count._all]));

  // Balances come from the leave service so the report always counts days exactly as the leave screens do.
  const rows: LeaveReportRow[] = [];
  const BATCH = 10;
  for (let i = 0; i < employees.length; i += BATCH) {
    const batch = employees.slice(i, i + BATCH);
    const balances = await Promise.all(batch.map((e) => leaveBalances(e.id, year)));
    batch.forEach((e, j) => {
      for (const b of balances[j]!) {
        rows.push({
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          department: e.department?.name ?? null,
          leaveType: b.name,
          isPaid: b.isPaid,
          entitlement: b.entitlement,
          approvedDays: b.used,
          pendingDays: b.pending,
          pendingRequests: pendingCount.get(`${e.id}|${b.leaveTypeId}`) ?? 0,
          remaining: b.remaining,
        });
      }
    });
  }
  return rows;
}

// ───────────── Payroll ─────────────

/** Deduction columns of the payroll register, by pay-line code (see src/core/payroll/calculate.ts). */
const DEDUCTION_COLUMNS = [
  { code: "PRORATION", header: "Not Employed" },
  { code: "ABSENT", header: "Absent" },
  { code: "UNPAID_LEAVE", header: "Unpaid Leave" },
  { code: "LATE", header: "Late / Missing Punch" },
  { code: "LOAN", header: "Loan" },
  { code: "ADJ_DEDUCTION", header: "Other Deductions" },
] as const;

function deductionsByCode(lines: Prisma.JsonValue): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(lines)) return out;
  for (const l of lines) {
    if (!l || typeof l !== "object" || Array.isArray(l) || l.kind !== "DEDUCTION" || typeof l.amount !== "number") continue;
    const known = DEDUCTION_COLUMNS.some((c) => c.code === l.code);
    const code = known ? String(l.code) : "ADJ_DEDUCTION";
    out[code] = (out[code] ?? 0) + l.amount;
  }
  return out;
}

function readEncrypted(value: string | null | undefined, full: boolean): string {
  if (!value) return "";
  try {
    const plain = decryptField(value);
    return full ? plain : maskValue(plain);
  } catch {
    return "(unreadable)";
  }
}

export async function payrollRunOptions(actor: Actor) {
  assertPermission(actor, "payroll.read", "all");
  const runs = await db.payrollRun.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }], select: { id: true, year: true, month: true, status: true } });
  return runs.map((r) => ({ ...r, label: monthName(r.year, r.month) }));
}

// ───────────── Filter options ─────────────

/** Employees the actor may report on — for the employee filter on the reports page. */
export async function reportEmployeeOptions(actor: Actor) {
  const scope = await scopedEmployeeWhere(actor, "report.read");
  return db.employee.findMany({
    where: { AND: [scope, { OR: [{ status: "ACTIVE" }, { exitDate: { not: null } }] }] },
    orderBy: { fullName: "asc" },
    select: { id: true, employeeCode: true, fullName: true },
  });
}

// ───────────── Excel ─────────────

export type ReportFile = { buffer: Buffer; filename: string };

type Column = { header: string; key: string; width: number; numFmt?: string };

const HEADER_ROW = 5;
const PKR = "#,##0";

async function companyName() {
  const c = await db.company.findFirst({ select: { legalName: true } });
  return c?.legalName ?? "RFS HCM";
}

/** A sheet with company name, report title and period on top, then a bold, frozen, filterable header row. */
function addSheet(wb: ExcelJS.Workbook, name: string, top: { company: string; title: string; period: string }, columns: Column[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  ws.columns = columns.map((c) => ({ key: c.key, width: c.width }));
  ws.getCell("A1").value = top.company;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = top.title;
  ws.getCell("A2").font = { bold: true, size: 12 };
  ws.getCell("A3").value = `${top.period} · Generated ${formatDateTime(new Date())} (PKT)`;
  ws.getCell("A3").font = { color: { argb: "FF6B7280" } };

  const header = ws.getRow(HEADER_ROW);
  header.values = columns.map((c) => c.header);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } }));
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: columns.length } };
  return ws;
}

function addRows(ws: ExcelJS.Worksheet, columns: Column[], rows: Record<string, unknown>[]) {
  for (const r of rows) {
    const row = ws.addRow(r);
    for (const c of columns) if (c.numFmt) row.getCell(c.key).numFmt = c.numFmt;
  }
}

/** Bold totals row with SUM formulas (and their values, for viewers that do not recalculate). */
function addTotals(ws: ExcelJS.Worksheet, columns: Column[], rows: Record<string, unknown>[], labelKey: string, sumKeys: readonly string[]) {
  const first = HEADER_ROW + 1;
  const last = HEADER_ROW + rows.length;
  const values: Record<string, unknown> = { [labelKey]: "TOTAL" };
  for (const key of sumKeys) {
    const letter = ws.getColumn(key).letter;
    const result = rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0);
    values[key] = rows.length ? { formula: `SUM(${letter}${first}:${letter}${last})`, result } : 0;
  }
  const row = ws.addRow(values);
  row.font = { bold: true };
  for (const c of columns) if (c.numFmt) row.getCell(c.key).numFmt = c.numFmt;
}

async function toFile(wb: ExcelJS.Workbook, filename: string): Promise<ReportFile> {
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename };
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RFS HCM";
  wb.created = new Date();
  return wb;
}

const mm = (month: number) => String(month).padStart(2, "0");

export async function attendanceSummaryWorkbook(actor: Actor, year: number, month: number, departmentId?: string): Promise<ReportFile> {
  const [rows, company, department] = await Promise.all([
    attendanceSummaryRows(actor, year, month, departmentId),
    companyName(),
    departmentId ? db.department.findUnique({ where: { id: departmentId }, select: { name: true } }) : null,
  ]);
  const columns: Column[] = [
    { header: "Employee Code", key: "code", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Department", key: "dept", width: 18 },
    { header: "Designation", key: "desig", width: 24 },
    { header: "Present Days", key: "present", width: 10 },
    { header: "On Time", key: "onTime", width: 9 },
    { header: "Late", key: "late", width: 8 },
    { header: "Early Leave", key: "early", width: 9 },
    { header: "Missing Punch", key: "missing", width: 10 },
    { header: "Half / Short Day", key: "halfShort", width: 10 },
    { header: "Half Day", key: "halfDay", width: 9 },
    { header: "Absent", key: "absent", width: 9 },
    { header: "Leave", key: "leave", width: 8 },
    { header: "Worked Hours", key: "hours", width: 10, numFmt: "0.0" },
    { header: "Late Minutes", key: "lateMin", width: 10, numFmt: PKR },
    { header: "Late + Missing", key: "lateMissing", width: 10 },
    { header: "Late Deduction Days (every 3 = 1)", key: "lateDays", width: 14 },
    { header: "Total Deduction Days (absent + late + 0.5 × half day)", key: "totalDays", width: 18 },
  ];
  const data = rows.map((r) => ({
    code: r.employeeCode, name: r.fullName, dept: r.department ?? "", desig: r.designation ?? "",
    present: r.present, onTime: r.onTime, late: r.late, early: r.early, missing: r.missing, halfShort: r.halfOrShort, halfDay: r.halfDay,
    absent: r.absent, leave: r.leave, hours: Math.round((r.workedMinutes / 60) * 10) / 10, lateMin: r.lateMinutes,
    lateMissing: r.lateAndMissing, lateDays: r.lateDeductionDays, totalDays: r.totalDeductionDays,
  }));
  const wb = newWorkbook();
  const period = `${monthName(year, month)}${department ? ` · ${department.name}` : ""}`;
  const ws = addSheet(wb, monthName(year, month), { company, title: "Monthly Attendance Summary", period }, columns);
  addRows(ws, columns, data);
  return toFile(wb, `rfs-attendance-summary-${year}-${mm(month)}.xlsx`);
}

export async function dailyDetailWorkbook(actor: Actor, from: string, to: string, filter: { departmentId?: string; employeeId?: string }): Promise<ReportFile> {
  const [rows, company] = await Promise.all([dailyDetailRows(actor, from, to, filter), companyName()]);
  const columns: Column[] = [
    { header: "Date", key: "date", width: 13 },
    { header: "Day", key: "day", width: 6 },
    { header: "Employee Code", key: "code", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Department", key: "dept", width: 18 },
    { header: "Status", key: "status", width: 14 },
    { header: "Check-in", key: "in", width: 12 },
    { header: "Check-out", key: "out", width: 22 },
    { header: "Worked (h:mm)", key: "worked", width: 10 },
    { header: "Late (min)", key: "late", width: 9 },
    { header: "Early Leave (min)", key: "early", width: 11 },
  ];
  const data = rows.map((r) => ({
    date: formatDate(d0(r.date)), day: d0(r.date).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
    code: r.employeeCode, name: r.fullName, dept: r.department ?? "", status: r.status, in: r.checkIn, out: r.checkOut,
    worked: r.worked, late: r.lateMinutes || "", early: r.earlyLeaveMinutes || "",
  }));
  const wb = newWorkbook();
  const ws = addSheet(wb, "Daily attendance", { company, title: "Daily Attendance Detail", period: `${formatDate(d0(from))} – ${formatDate(d0(to))}` }, columns);
  addRows(ws, columns, data);
  return toFile(wb, `rfs-attendance-daily-${from}-to-${to}.xlsx`);
}

export async function leaveReportWorkbook(actor: Actor, year: number, departmentId?: string): Promise<ReportFile> {
  const [rows, company] = await Promise.all([leaveReportRows(actor, year, departmentId), companyName()]);
  const columns: Column[] = [
    { header: "Employee Code", key: "code", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Department", key: "dept", width: 18 },
    { header: "Leave Type", key: "type", width: 18 },
    { header: "Paid", key: "paid", width: 7 },
    { header: "Entitlement (days)", key: "entitlement", width: 12 },
    { header: "Approved Days Taken", key: "approved", width: 12 },
    { header: "Pending Days", key: "pendingDays", width: 10 },
    { header: "Pending Requests", key: "pendingRequests", width: 10 },
    { header: "Remaining", key: "remaining", width: 10 },
  ];
  const data = rows.map((r) => ({
    code: r.employeeCode, name: r.fullName, dept: r.department ?? "", type: r.leaveType, paid: r.isPaid ? "Yes" : "No",
    entitlement: r.entitlement ?? "No limit", approved: r.approvedDays, pendingDays: r.pendingDays, pendingRequests: r.pendingRequests,
    remaining: r.remaining ?? "",
  }));
  const wb = newWorkbook();
  const ws = addSheet(wb, `Leave ${year}`, { company, title: "Leave Report", period: `January – December ${year}` }, columns);
  addRows(ws, columns, data);
  return toFile(wb, `rfs-leave-${year}.xlsx`);
}

/**
 * Payroll register (one row per payslip, every deduction in its own column, totals) plus a "Bank transfer" sheet.
 * Account numbers are shown in full only to users allowed to see all bank details; everyone else gets the last 4.
 */
export async function payrollRegisterWorkbook(actor: Actor, runId: string): Promise<ReportFile> {
  assertPermission(actor, "payroll.read", "all");
  const [run, company] = await Promise.all([
    db.payrollRun.findUnique({
      where: { id: runId },
      include: { items: { orderBy: { fullName: "asc" }, include: { employee: { select: { bankAccount: true } } } } },
    }),
    companyName(),
  ]);
  if (!run) throw new NotFoundError("Payroll not found.");
  const fullBank = can(actor, "bank.read", "all");
  const label = monthName(run.year, run.month);
  const period = `${label} · ${run.status.charAt(0)}${run.status.slice(1).toLowerCase()}`;
  const wb = newWorkbook();

  const columns: Column[] = [
    { header: "Employee Code", key: "code", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Department", key: "dept", width: 18 },
    { header: "Designation", key: "desig", width: 24 },
    { header: "Basic Salary", key: "basic", width: 13, numFmt: PKR },
    { header: "Allowances", key: "allowances", width: 12, numFmt: PKR },
    { header: "Gross Salary", key: "gross", width: 13, numFmt: PKR },
    { header: "Employed Days", key: "employed", width: 9 },
    { header: "Present", key: "present", width: 8 },
    { header: "Absent", key: "absent", width: 8 },
    { header: "Late", key: "late", width: 7 },
    { header: "Missing Punch", key: "missing", width: 9 },
    { header: "Late Deduction Days", key: "lateDays", width: 10 },
    { header: "Total Earnings", key: "earnings", width: 13, numFmt: PKR },
    ...DEDUCTION_COLUMNS.map((c) => ({ header: c.header, key: c.code, width: 12, numFmt: PKR })),
    { header: "Total Deductions", key: "deductions", width: 13, numFmt: PKR },
    { header: "Net Pay", key: "net", width: 13, numFmt: PKR },
  ];
  const data = run.items.map((i) => {
    const byCode = deductionsByCode(i.lines);
    return {
      code: i.employeeCode, name: i.fullName, dept: i.department ?? "", desig: i.designation ?? "",
      basic: Number(i.basicSalary), allowances: Number(i.grossSalary) - Number(i.basicSalary), gross: Number(i.grossSalary),
      employed: i.employedDays, present: i.presentDays, absent: i.absentDays, late: i.lateCount, missing: i.missingPunchCount,
      lateDays: i.lateDeductionDays, earnings: Number(i.earnings),
      ...Object.fromEntries(DEDUCTION_COLUMNS.map((c) => [c.code, byCode[c.code] ?? 0])),
      deductions: Number(i.deductions), net: Number(i.netPay),
    };
  });
  const register = addSheet(wb, "Payroll register", { company, title: "Payroll Register", period }, columns);
  addRows(register, columns, data);
  addTotals(register, columns, data, "name", ["basic", "allowances", "gross", "earnings", ...DEDUCTION_COLUMNS.map((c) => c.code), "deductions", "net"]);

  const bankColumns: Column[] = [
    { header: "Employee Code", key: "code", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Bank", key: "bank", width: 20 },
    { header: "Branch", key: "branch", width: 18 },
    { header: "Account Title", key: "title", width: 26 },
    { header: "Account Number", key: "account", width: 22 },
    { header: "IBAN", key: "iban", width: 30 },
    { header: "Net Pay", key: "net", width: 13, numFmt: PKR },
  ];
  const bankData = run.items.map((i) => {
    const b = i.employee?.bankAccount;
    return {
      code: i.employeeCode, name: i.fullName, bank: b?.bankName ?? "No bank account on file", branch: b?.branch ?? "",
      title: b?.accountTitle ?? "", account: readEncrypted(b?.accountNumberEnc, fullBank), iban: readEncrypted(b?.ibanEnc, fullBank),
      net: Number(i.netPay),
    };
  });
  const bankPeriod = fullBank ? period : `${period} · Account numbers masked (full details need "View bank details — all")`;
  const bank = addSheet(wb, "Bank transfer", { company, title: "Bank Transfer List", period: bankPeriod }, bankColumns);
  addRows(bank, bankColumns, bankData);
  addTotals(bank, bankColumns, bankData, "name", ["net"]);

  await recordAudit({ actor, action: "report.payroll_register", entityType: "PayrollRun", entityId: run.id, after: { month: label, fullBankDetails: fullBank } });
  return toFile(wb, `rfs-payroll-register-${run.year}-${mm(run.month)}.xlsx`);
}
