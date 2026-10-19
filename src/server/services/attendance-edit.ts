import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { assertEmployeeAccess, scopedEmployeeWhere } from "@/server/auth/scope";
import { recomputeAttendance } from "@/server/services/attendance";
import { isPayrollLockedFor } from "@/server/services/payroll-lock";
import { instantAt, PKT_OFFSET_MIN, ruleForDate, type DayAwareShift } from "@/core/attendance/engine";
import { formatMinuteOfDay, parseTimeOfDay } from "@/lib/format";
import { parseDateOnly, todayInPKT, toDateOnlyString } from "@/lib/dates";
import { attendanceStartOf, trackedFrom, weekendOf } from "@/server/json-fields";
import { holidayDatesBetween } from "@/server/services/holidays";

const MAX_DAY_MINUTES = 20 * 60;
/** Without a shift, a lone check-out before this time is taken as after midnight (e.g. 00:30). */
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
  /** Company-sanctioned: the edited time is not counted late/early (both blank: the whole day is Present). */
  excused: boolean;
};

/** Checks shared by single and bulk edits. Returns the normalised work date. */
async function validateAdjustment(actor: Actor, dateStr: string, input: AdjustmentInput) {
  assertPermission(actor, "attendance.edit", "all");
  const date = toDateOnlyString(parseDateOnly(dateStr));
  if (date > toDateOnlyString(todayInPKT())) throw new AppError("You cannot set attendance for a future date.");
  const start = await attendanceStart();
  if (start && date < start) throw new AppError(`Attendance is tracked in this system from ${start}; earlier days were managed in the previous software.`);
  if (await isPayrollLockedFor(date)) throw new AppError("Payroll for this month is approved, so its attendance is locked. Record any correction as an adjustment in next month's payroll.");
  if (!input.checkIn && !input.checkOut && !input.excused) {
    throw new AppError("Enter a check-in or check-out time (both may be empty only for work from home or load shedding).");
  }
  if (input.reason.trim().length < 3) throw new AppError("Give a reason for the change.");
  return date;
}

/**
 * Turn "HH:MM" inputs into instants on the work date. A check-out at or before the check-in falls on the next
 * day. A check-out given on its own falls on the next day when it is before the shift start (12:00 on a
 * 3 PM–12 AM shift means midnight, not noon). A time not given stays empty, so the machine punch is used.
 */
function resolveTimes(
  date: string,
  input: Pick<AdjustmentInput, "checkIn" | "checkOut">,
  shiftStartMin: number | null,
) {
  const inMin = input.checkIn ? parseTimeOfDay(input.checkIn) : null;
  const checkIn = inMin !== null ? instantAt(date, inMin) : null;
  let checkOut: Date | null = null;
  if (input.checkOut) {
    let outMin = parseTimeOfDay(input.checkOut);
    const reference = checkIn ? Math.round((checkIn.getTime() - instantAt(date, 0).getTime()) / 60_000) : null;
    const cutoff = shiftStartMin ?? NEXT_DAY_CUTOFF_MIN;
    if (reference !== null ? outMin <= reference : outMin < cutoff) outMin += 1440;
    checkOut = instantAt(date, outMin);
  }
  if (checkIn && checkOut) {
    if (checkOut <= checkIn) throw new AppError("Check-out must be after check-in.");
    if ((checkOut.getTime() - checkIn.getTime()) / 60_000 > MAX_DAY_MINUTES) throw new AppError("Check-in to check-out cannot be longer than 20 hours.");
  }
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

type ShiftWithOverrides = Omit<DayAwareShift, "overrides"> & {
  dayOverrides: { weekday: number; startMinute: number; endMinute: number; graceMinutes: number | null }[];
};

const defaultShift = () => db.shift.findFirst({ where: { isDefault: true, isActive: true }, include: { dayOverrides: true } });

function shiftStartFor(shift: ShiftWithOverrides | null, date: string): number | null {
  return shift ? ruleForDate({ ...shift, overrides: shift.dayOverrides }, date).startMinute : null;
}

export async function saveAttendanceAdjustment(actor: Actor, input: AdjustmentInput & { employeeId: string; date: string }) {
  const date = await validateAdjustment(actor, input.date, input);
  const employee = await db.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, joiningDate: true, exitDate: true, shift: { include: { dayOverrides: true } } },
  });
  if (!employee) throw new NotFoundError("Employee not found.");
  if (date < toDateOnlyString(employee.joiningDate)) throw new AppError("That date is before the employee's joining date.");
  if (employee.exitDate && date > toDateOnlyString(employee.exitDate)) throw new AppError("That date is after the employee's exit date.");

  const shiftStart = shiftStartFor(employee.shift ?? (await defaultShift()), date);
  const { checkIn, checkOut } = resolveTimes(date, input, shiftStart);
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
 * early off). Times left empty use each employee's machine punch.
 * Employees that cannot be changed are skipped with a reason rather than failing the whole batch.
 */
export async function bulkSaveAttendanceAdjustments(actor: Actor, input: AdjustmentInput & { employeeIds: string[]; date: string }) {
  const date = await validateAdjustment(actor, input.date, input);
  const ids = [...new Set(input.employeeIds)];
  if (ids.length === 0) throw new AppError("Select at least one employee.");
  if (ids.length > 500) throw new AppError("Select at most 500 employees at a time.");
  const workDate = new Date(`${date}T00:00:00Z`);

  const [employees, beforeDays] = await Promise.all([
    db.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, joiningDate: true, exitDate: true, shift: { include: { dayOverrides: true } } },
    }),
    db.attendanceDay.findMany({ where: { employeeId: { in: ids }, workDate } }),
  ]);
  const fallbackShift = await defaultShift();
  const beforeBy = new Map(beforeDays.map((d) => [d.employeeId, d]));

  const skipped: { name: string; reason: string }[] = [];
  const updated: string[] = [];
  for (const e of employees) {
    if (date < toDateOnlyString(e.joiningDate)) { skipped.push({ name: e.fullName, reason: "joined after this date" }); continue; }
    if (e.exitDate && date > toDateOnlyString(e.exitDate)) { skipped.push({ name: e.fullName, reason: "had left by this date" }); continue; }
    let times;
    try {
      // A time left empty means "use the machine punch", even where an earlier manual change set one.
      times = resolveTimes(date, input, shiftStartFor(e.shift ?? fallbackShift, date));
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

/** Remove the manual change for many employees on one date; machine times apply again. */
export async function bulkRemoveAttendanceAdjustments(actor: Actor, employeeIds: string[], dateStr: string) {
  assertPermission(actor, "attendance.edit", "all");
  const date = toDateOnlyString(parseDateOnly(dateStr));
  const workDate = new Date(`${date}T00:00:00Z`);
  if (await isPayrollLockedFor(date)) throw new AppError("Payroll for this month is approved, so its attendance is locked.");
  const existing = await db.attendanceAdjustment.findMany({ where: { employeeId: { in: [...new Set(employeeIds)] }, workDate } });
  if (existing.length === 0) return { removed: 0 };
  await db.attendanceAdjustment.deleteMany({ where: { id: { in: existing.map((a) => a.id) } } });
  await recomputeAttendance({ employeeIds: existing.map((a) => a.employeeId), from: date, to: date });
  for (const a of existing) {
    await recordAudit({
      actor, action: "attendance.adjust_removed", entityType: "Employee", entityId: a.employeeId,
      before: { date, checkIn: localTime(a.checkIn, date)?.time ?? null, checkOut: localTime(a.checkOut, date)?.time ?? null, reason: a.reason, batchSize: existing.length },
    });
  }
  return { removed: existing.length };
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
  /** The manual change, only for people who may edit attendance (others never see that a day was edited). */
  adjustment: { checkIn: string | null; checkOut: string | null; reason: string; category: string; excused: boolean } | null;
};

type EmployeeForRegister = {
  id: string; employeeCode: string; fullName: string; department: { name: string } | null;
  shift: (DayAwareShift & { dayOverrides: { weekday: number; startMinute: number; endMinute: number; graceMinutes: number | null }[] }) | null;
};

async function buildRows(employees: EmployeeForRegister[], dates: string[], canEdit: boolean): Promise<RegisterRow[]> {
  if (!employees.length || !dates.length) return [];
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const range = { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) };
  const ids = employees.map((e) => e.id);
  const [days, adjustments, company, holidays, defaultShift] = await Promise.all([
    db.attendanceDay.findMany({ where: { employeeId: { in: ids }, workDate: range } }),
    canEdit ? db.attendanceAdjustment.findMany({ where: { employeeId: { in: ids }, workDate: range } }) : [],
    db.company.findFirst({ select: { weekendDays: true } }),
    holidayDatesBetween(first, last),
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
        isOffDay: weekend.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) || holidays.has(date),
        shiftLabel: rule ? `${formatMinuteOfDay(rule.startMinute)} – ${formatMinuteOfDay(rule.endMinute)}` : "—",
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
const attendanceStart = async () => attendanceStartOf(await db.company.findFirst({ select: { attendanceStartDate: true } }));

export async function dailyRegister(actor: Actor, date: string, departmentId?: string, search?: string) {
  const q = search?.trim();
  const scope = await scopedEmployeeWhere(actor, "attendance.read");
  const d = toDateOnlyString(parseDateOnly(date));
  const start = await attendanceStart();
  // Before the attendance start the previous software holds the record, so nothing is listed.
  if (start && d < start) return { rows: [], canEdit: false, trackedFrom: start };
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
  const canEdit = can(actor, "attendance.edit", "all");
  return { rows: await buildRows(employees, [d], canEdit), canEdit, trackedFrom: start };
}

/** One employee's month, day by day. */
export async function monthRegister(actor: Actor, employeeId: string, year: number, month: number) {
  await assertEmployeeAccess(actor, "attendance.read", employeeId);
  const employee = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { ...employeeSelect, joiningDate: true, exitDate: true } });
  const today = toDateOnlyString(todayInPKT());
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const tracked = trackedFrom(toDateOnlyString(employee.joiningDate), await attendanceStart());
  const dates = Array.from({ length: dim }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`).filter(
    (d) => d <= today && d >= tracked && (!employee.exitDate || d <= toDateOnlyString(employee.exitDate)),
  );
  const canEdit = can(actor, "attendance.edit", "all");
  return { rows: await buildRows([employee], dates, canEdit), canEdit };
}
