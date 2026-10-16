import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { assertEmployeeAccess, scopedEmployeeWhere } from "@/server/auth/scope";
import { recomputeAttendance } from "@/server/services/attendance";
import { addDaysIso, instantAt, localMidnight, PKT_OFFSET_MIN, ruleForDate, workDateOf, type DayAwareShift } from "@/core/attendance/engine";
import { formatMinuteOfDay, parseTimeOfDay } from "@/lib/format";
import { parseDateOnly, todayInPKT, toDateOnlyString } from "@/lib/dates";

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

export async function saveAttendanceAdjustment(
  actor: Actor,
  input: { employeeId: string; date: string; checkIn: string | null; checkOut: string | null; reason: string },
) {
  assertPermission(actor, "attendance.edit", "all");
  const date = toDateOnlyString(parseDateOnly(input.date));
  const today = toDateOnlyString(todayInPKT());
  if (date > today) throw new AppError("You cannot set attendance for a future date.");
  if (!input.checkIn && !input.checkOut) throw new AppError("Enter a check-in time, a check-out time, or both.");
  if (input.reason.trim().length < 3) throw new AppError("Give a reason for the change.");

  const employee = await db.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, fullName: true, employeeCode: true, joiningDate: true, exitDate: true } });
  if (!employee) throw new NotFoundError("Employee not found.");
  if (date < toDateOnlyString(employee.joiningDate)) throw new AppError("That date is before the employee's joining date.");
  if (employee.exitDate && date > toDateOnlyString(employee.exitDate)) throw new AppError("That date is after the employee's exit date.");

  const inMin = input.checkIn ? parseTimeOfDay(input.checkIn) : null;
  let outMin = input.checkOut ? parseTimeOfDay(input.checkOut) : null;
  if (outMin !== null) {
    if (inMin !== null ? outMin <= inMin : outMin < NEXT_DAY_CUTOFF_MIN) outMin += 1440;
  }
  if (inMin !== null && outMin !== null && outMin - inMin > MAX_DAY_MINUTES) throw new AppError("Check-in to check-out cannot be longer than 20 hours.");

  const checkIn = inMin !== null ? instantAt(date, inMin) : null;
  const checkOut = outMin !== null ? instantAt(date, outMin) : null;
  const workDate = new Date(`${date}T00:00:00Z`);

  const before = await db.attendanceDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
  const previous = await db.attendanceAdjustment.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
  await db.attendanceAdjustment.upsert({
    where: { employeeId_workDate: { employeeId: employee.id, workDate } },
    create: { employeeId: employee.id, workDate, checkIn, checkOut, reason: input.reason.trim(), createdById: actor.userId },
    update: { checkIn, checkOut, reason: input.reason.trim(), createdById: actor.userId },
  });
  await recomputeAttendance({ employeeIds: [employee.id], from: date, to: date });
  const after = await db.attendanceDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });

  await recordAudit({
    actor,
    action: "attendance.adjust",
    entityType: "Employee",
    entityId: employee.id,
    before: {
      date,
      status: before?.status ?? null,
      checkIn: localTime(before?.firstIn ?? null, date)?.time ?? null,
      checkOut: localTime(before?.lastOut ?? null, date)?.time ?? null,
      previousAdjustmentReason: previous?.reason ?? null,
    },
    after: {
      date,
      status: after?.status ?? null,
      checkIn: localTime(after?.firstIn ?? null, date)?.time ?? null,
      checkOut: localTime(after?.lastOut ?? null, date)?.time ?? null,
      reason: input.reason.trim(),
    },
  });
  return after;
}

export async function removeAttendanceAdjustment(actor: Actor, employeeId: string, dateStr: string) {
  assertPermission(actor, "attendance.edit", "all");
  const date = toDateOnlyString(parseDateOnly(dateStr));
  const workDate = new Date(`${date}T00:00:00Z`);
  const existing = await db.attendanceAdjustment.findUnique({ where: { employeeId_workDate: { employeeId, workDate } } });
  if (!existing) throw new NotFoundError("There is no manual change on that day.");
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
  adjustment: { checkIn: string | null; checkOut: string | null; reason: string } | null;
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
  const weekend = company?.weekendDays ?? [0, 6];
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
        adjustment: a ? { checkIn: localTime(a.checkIn, date)?.time ?? null, checkOut: localTime(a.checkOut, date)?.time ?? null, reason: a.reason } : null,
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
        q ? { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { employeeCode: { contains: q, mode: "insensitive" } }] } : {},
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
