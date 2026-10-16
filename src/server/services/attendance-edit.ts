import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { assertEmployeeAccess, scopedEmployeeWhere } from "@/server/auth/scope";
import { recomputeAttendance } from "@/server/services/attendance";
import { isPayrollLockedFor } from "@/server/services/payroll-lock";
import { addDaysIso, instantAt, localMidnight, PKT_OFFSET_MIN, ruleForDate, workDateOf, type DayAwareShift } from "@/core/attendance/engine";
import { formatMinuteOfDay, parseTimeOfDay } from "@/lib/format";
import { parseDateOnly, todayInPKT, toDateOnlyString } from "@/lib/dates";
import { weekendOf } from "@/server/json-fields";

const MAX_DAY_MINUTES = 20 * 60;
/** A lone check-out before this time is taken as after midnight (e.g. 00:30 on a 2 PM–11 PM shift). */
const NEXT_DAY_CUTOFF_MIN = 6 * 60;

/** Local "HH:MM" for an instant, with a "+1" marker when it falls on the day after the work date. */
export function localTime(instant: Date | null, workDate: string): { time: string; nextDay: boolean } | null {
  if (!instant) return null;
  const local = new Date(instant.getTime() + PKT_OFFSET_MIN * 60_000).toISOString();
  return { time: local.slice(11, 16), nextDay: local.slice(0, 10) > workDate };
}

// ───────────── Write ─────────────

export const ADJUSTMENT_CATEGORIES = ["WORK_FROM_HOME", "LOAD_SHEDDING", "OTHER"] as const;
export type AdjustmentCategory = (typeof ADJUSTMENT_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<AdjustmentCategory, string> = {
  WORK_FROM_HOME: "Work from home",
  LOAD_SHEDDING: "Load shedding / early off",
  OTHER: "Correction",
};

export type AdjustmentInput = {
  checkIn: string | null; // "HH:MM"
  checkOut: string | null;
  reason: string;
  category: AdjustmentCategory;
  /** Company-sanctioned: count the day as Present with no late/early. */
  excused: boolean;
};

/** Checks shared by single and bulk edits. Returns the normalised work date. */
async function validateAdjustment(actor: Actor, dateStr: string, input: AdjustmentInput, allowOneSided: boolean) {
  assertPermission(actor, "attendance.edit", "all");
  const date = toDateOnlyString(parseDateOnly(dateStr));
  if (date > toDateOnlyString(todayInPKT())) throw new AppError("You cannot set attendance for a future date.");
  if (await isPayrollLockedFor(date)) throw new AppError("Payroll for this month is approved, so its attendance is locked. Record any correction as an adjustment in next month's payroll.");
  if (!allowOneSided && !input.checkIn && !input.checkOut) throw new AppError("Enter a check-in time, a check-out time, or both.");
  if (input.reason.trim().length < 3) throw new AppError("Give a reason for the change.");
  return date;
}

/**
 * Turn "HH:MM" inputs into instants on the work date. A check-out at or before the check-in (or, on its own,
 * before 6 AM) falls on the next day. Times not given fall back to `fallback` (an existing manual change).
 */
function resolveTimes(date: string, input: Pick<AdjustmentInput, "checkIn" | "checkOut">, fallback?: { checkIn: Date | null; checkOut: Date | null }) {
  const inMin = input.checkIn ? parseTimeOfDay(input.checkIn) : null;
  const checkIn = inMin !== null ? instantAt(date, inMin) : (fallback?.checkIn ?? null);
  let checkOut: Date | null = fallback?.checkOut ?? null;
  if (input.checkOut) {
    let outMin = parseTimeOfDay(input.checkOut);
    const reference = checkIn ? Math.round((checkIn.getTime() - instantAt(date, 0).getTime()) / 60_000) : null;
    if (reference !== null ? outMin <= reference : outMin < NEXT_DAY_CUTOFF_MIN) outMin += 1440;
    checkOut = instantAt(date, outMin);
  }
  if (checkIn && checkOut) {
    if (checkOut <= checkIn) throw new AppError("Check-out must be after check-in.");
    if ((checkOut.getTime() - checkIn.getTime()) / 60_000 > MAX_DAY_MINUTES) throw new AppError("Check-in to check-out cannot be longer than 20 hours.");
  }
  if (!checkIn && !checkOut) throw new AppError("Enter a check-in time, a check-out time, or both.");
  return { checkIn, checkOut };
}

function snapshot(day: { status: string; firstIn: Date | null; lastOut: Date | null } | null, date: string) {
  return {
    date,
    status: day?.status ?? null,
    checkIn: localTime(day?.firstIn ?? null, date)?.time ?? null,
    checkOut: localTime(day?.lastOut ?? null, date)?.time ?? null,
  };
}

export async function saveAttendanceAdjustment(actor: Actor, input: AdjustmentInput & { employeeId: string; date: string }) {
  const date = await validateAdjustment(actor, input.date, input, false);
  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, joiningDate: true, exitDate: true } });
  if (!employee) throw new NotFoundError("Employee not found.");
  if (date < toDateOnlyString(employee.joiningDate)) throw new AppError("That date is before the employee's joining date.");
  if (employee.exitDate && date > toDateOnlyString(employee.exitDate)) throw new AppError("That date is after the employee's exit date.");

  const { checkIn, checkOut } = resolveTimes(date, input);
  const workDate = new Date(`${date}T00:00:00Z`);
  const key = { employeeId_workDate: { employeeId: employee.id, workDate } };
  const before = await db.attendanceDay.findUnique({ where: key });
  const data = { checkIn, checkOut, category: input.category, excused: input.excused, reason: input.reason.trim(), createdById: actor.userId };
  await db.attendanceAdjustment.upsert({ where: key, create: { employeeId: employee.id, workDate, ...data }, update: data });
  await recomputeAttendance({ employeeIds: [employee.id], from: date, to: date });
  const after = await db.attendanceDay.findUnique({ where: key });

  await recordAudit({
    actor, action: "attendance.adjust", entityType: "Employee", entityId: employee.id,
    before: snapshot(before, date),
    after: { ...snapshot(after, date), category: input.category, excused: input.excused, reason: input.reason.trim() },
  });
  return after;
}

/**
 * Apply the same correction to many employees for one date (e.g. a work-from-home day or a load-shedding
 * early off). Times left empty keep each employee's existing manual time (or the machine's).
 * Employees that cannot be changed are skipped with a reason rather than failing the whole batch.
 */
export async function bulkSaveAttendanceAdjustments(actor: Actor, input: AdjustmentInput & { employeeIds: string[]; date: string }) {
  const date = await validateAdjustment(actor, input.date, input, false);
  const ids = [...new Set(input.employeeIds)];
  if (ids.length === 0) throw new AppError("Select at least one employee.");
  if (ids.length > 500) throw new AppError("Select at most 500 employees at a time.");
  const workDate = new Date(`${date}T00:00:00Z`);

  const [employees, existing, beforeDays] = await Promise.all([
    db.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, joiningDate: true, exitDate: true } }),
    db.attendanceAdjustment.findMany({ where: { employeeId: { in: ids }, workDate } }),
    db.attendanceDay.findMany({ where: { employeeId: { in: ids }, workDate } }),
  ]);
  const existingBy = new Map(existing.map((a) => [a.employeeId, a]));
  const beforeBy = new Map(beforeDays.map((d) => [d.employeeId, d]));

  const skipped: { name: string; reason: string }[] = [];
  const updated: string[] = [];
  for (const e of employees) {
    if (date < toDateOnlyString(e.joiningDate)) { skipped.push({ name: e.fullName, reason: "joined after this date" }); continue; }
    if (e.exitDate && date > toDateOnlyString(e.exitDate)) { skipped.push({ name: e.fullName, reason: "had left by this date" }); continue; }
    let times;
    try {
      times = resolveTimes(date, input, existingBy.get(e.id));
    } catch (err) {
      skipped.push({ name: e.fullName, reason: err instanceof AppError ? err.message : "invalid times" });
      continue;
    }
    const data = { ...times, category: input.category, excused: input.excused, reason: input.reason.trim(), createdById: actor.userId };
    await db.attendanceAdjustment.upsert({
      where: { employeeId_workDate: { employeeId: e.id, workDate } },
      create: { employeeId: e.id, workDate, ...data },
      update: data,
    });
    updated.push(e.id);
  }
  if (updated.length) await recomputeAttendance({ employeeIds: updated, from: date, to: date });

  const afterDays = await db.attendanceDay.findMany({ where: { employeeId: { in: updated }, workDate } });
  const afterBy = new Map(afterDays.map((d) => [d.employeeId, d]));
  for (const id of updated) {
    await recordAudit({
      actor, action: "attendance.adjust_bulk", entityType: "Employee", entityId: id,
      before: snapshot(beforeBy.get(id) ?? null, date),
      after: { ...snapshot(afterBy.get(id) ?? null, date), category: input.category, excused: input.excused, reason: input.reason.trim(), batchSize: updated.length },
    });
  }
  return { updated: updated.length, skipped };
}

export async function removeAttendanceAdjustment(actor: Actor, employeeId: string, dateStr: string) {
  assertPermission(actor, "attendance.edit", "all");
  const date = toDateOnlyString(parseDateOnly(dateStr));
  const workDate = new Date(`${date}T00:00:00Z`);
  const existing = await db.attendanceAdjustment.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });
  if (!existing) throw new NotFoundError("There is no manual change on that day.");
  if (await isPayrollLockedFor(date)) throw new AppError("Payroll for this month is approved, so its attendance is locked.");
  await db.attendanceAdjustment.delete({ where: { id: existing.id } });
  await recomputeAttendance({ employeeIds: [employeeId], from: date, to: date });
  await recordAudit({
    actor,
    action: "attendance.adjust_removed",
    entityType: "Employee",
    entityId: employeeId,
    before: { date, checkIn: localTime(existing.checkIn, date)?.time ?? null, checkOut: localTime(existing.checkOut, date)?.time ?? null, reason: existing.reason },
  });
}

// ───────────── Read ─────────────

export type RegisterRow = {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  date: string;
  status: string | null;
  checkIn: { time: string; nextDay: boolean } | null;
  checkOut: { time: string; nextDay: boolean } | null;
  workedMinutes: number | null;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  isOffDay: boolean;
  shiftLabel: string;
  machinePunches: { time: string; nextDay: boolean }[];
  adjustment: { checkIn: string | null; checkOut: string | null; reason: string; category: string; excused: boolean } | null;
};

type EmployeeForRegister = {
  id: string; employeeCode: string; fullName: string; department: { name: string } | null;
  shift: (DayAwareShift & { dayOverrides: { weekday: number; startMinute: number; endMinute: number; graceMinutes: number | null }[] }) | null;
};

async function buildRows(employees: EmployeeForRegister[], dates: string[]): Promise<RegisterRow[]> {
  if (!employees.length || !dates.length) return [];
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const range = { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) };
  const ids = employees.map((e) => e.id);
  const [days, adjustments, punches, company, defaultShift] = await Promise.all([
    db.attendanceDay.findMany({ where: { employeeId: { in: ids }, workDate: range } }),
    db.attendanceAdjustment.findMany({ where: { employeeId: { in: ids }, workDate: range } }),
    db.rawPunch.findMany({
      where: { employeeId: { in: ids }, punchedAt: { gte: localMidnight(addDaysIso(first, -1)), lt: localMidnight(addDaysIso(last, 2)) } },
      select: { employeeId: true, punchedAt: true },
      orderBy: { punchedAt: "asc" },
    }),
    db.company.findFirst({ select: { weekendDays: true } }),
    db.shift.findFirst({ where: { isDefault: true }, include: { dayOverrides: true } }),
  ]);
  const weekend = weekendOf(company);
  const key = (id: string, d: string) => `${id}|${d}`;
  const dayMap = new Map(days.map((d) => [key(d.employeeId, toDateOnlyString(d.workDate)), d]));
  const adjMap = new Map(adjustments.map((a) => [key(a.employeeId, toDateOnlyString(a.workDate)), a]));

  const rows: RegisterRow[] = [];
  for (const e of employees) {
    const s = e.shift ?? defaultShift;
    const shift: DayAwareShift | null = s ? { ...s, overrides: s.dayOverrides } : null;
    const punchesByDate = new Map<string, Date[]>();
    if (shift) {
      for (const p of punches) {
        if (p.employeeId !== e.id) continue;
        const wd = workDateOf(p.punchedAt, shift);
        (punchesByDate.get(wd) ?? punchesByDate.set(wd, []).get(wd)!).push(p.punchedAt);
      }
    }
    for (const date of dates) {
      const d = dayMap.get(key(e.id, date));
      const a = adjMap.get(key(e.id, date));
      const rule = shift ? ruleForDate(shift, date) : null;
      rows.push({
        employeeId: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        department: e.department?.name ?? null,
        date,
        status: d?.status ?? null,
        checkIn: localTime(d?.firstIn ?? null, date),
        checkOut: localTime(d?.lastOut ?? null, date),
        workedMinutes: d?.workedMinutes ?? null,
        lateMinutes: d?.lateMinutes ?? 0,
        earlyLeaveMinutes: d?.earlyLeaveMinutes ?? 0,
        isOffDay: weekend.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
        shiftLabel: rule ? `${formatMinuteOfDay(rule.startMinute)} – ${formatMinuteOfDay(rule.endMinute)}` : "—",
        machinePunches: (punchesByDate.get(date) ?? []).map((p) => localTime(p, date)!),
        adjustment: a ? { checkIn: localTime(a.checkIn, date)?.time ?? null, checkOut: localTime(a.checkOut, date)?.time ?? null, reason: a.reason, category: a.category, excused: a.excused } : null,
      });
    }
  }
  return rows;
}

const employeeSelect = {
  id: true, employeeCode: true, fullName: true,
  department: { select: { name: true } },
  shift: { include: { dayOverrides: true } },
} satisfies Prisma.EmployeeSelect;

/** Every employee (within the viewer's scope) on one date, optionally filtered by department and name/code search. */
export async function dailyRegister(actor: Actor, date: string, departmentId?: string, search?: string) {
  const q = search?.trim();
  const scope = await scopedEmployeeWhere(actor, "attendance.read");
  const d = toDateOnlyString(parseDateOnly(date));
  const workDate = new Date(`${d}T00:00:00Z`);
  const employees = await db.employee.findMany({
    where: {
      AND: [
        scope,
        departmentId ? { departmentId } : {},
        q ? { OR: [{ fullName: { contains: q } }, { employeeCode: { contains: q } }] } : {},
        { joiningDate: { lte: workDate } },
        { OR: [{ exitDate: null }, { exitDate: { gte: workDate } }] },
        { OR: [{ status: "ACTIVE" }, { exitDate: { not: null } }] },
      ],
    },
    orderBy: { fullName: "asc" },
    select: employeeSelect,
  });
  return { rows: await buildRows(employees, [d]), canEdit: can(actor, "attendance.edit", "all") };
}

/** One employee's month, day by day. */
export async function monthRegister(actor: Actor, employeeId: string, year: number, month: number) {
  await assertEmployeeAccess(actor, "attendance.read", employeeId);
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { ...employeeSelect, joiningDate: true, exitDate: true } });
  const today = toDateOnlyString(todayInPKT());
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = Array.from({ length: dim }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`).filter(
    (d) => d <= today && d >= toDateOnlyString(employee.joiningDate) && (!employee.exitDate || d <= toDateOnlyString(employee.exitDate)),
  );
  return { rows: await buildRows([employee], dates), canEdit: can(actor, "attendance.edit", "all") };
}
