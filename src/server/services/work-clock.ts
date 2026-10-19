import "server-only";
import { db } from "@/server/db";
import { ruleForDate, shiftEndOffset, workDateOf, type DayAwareShift } from "@/core/attendance/engine";
import { holidaysBetween } from "@/server/services/holidays";
import { formatMinuteOfDay } from "@/lib/format";
import { weekendOf } from "@/server/json-fields";

export type WorkClock = {
  workDate: string;
  shiftLabel: string;
  shiftMinutes: number;
  /** ISO instants; null when there is no punch yet. */
  signIn: string | null;
  signOut: string | null;
  offDay: string | null; // "Weekend" or the holiday name
};

/** Today's sign-in/out for the employee's current work day (a 3 PM–12 AM shift still counts at 12:30 AM). */
export async function todayWorkClock(employeeId: string): Promise<WorkClock | null> {
  const [employee, defaultShift, company] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { shift: { include: { dayOverrides: true } } } }),
    db.shift.findFirst({ where: { isDefault: true, isActive: true }, include: { dayOverrides: true } }),
    db.company.findFirst({ select: { weekendDays: true } }),
  ]);
  const s = employee?.shift ?? defaultShift;
  if (!s) return null;
  const shift: DayAwareShift = { ...s, overrides: s.dayOverrides };
  const workDate = workDateOf(new Date(), shift);
  const rule = ruleForDate(shift, workDate);
  const [day, holidays] = await Promise.all([
    db.attendanceDay.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: new Date(`${workDate}T00:00:00Z`) } },
      select: { firstIn: true, lastOut: true },
    }),
    holidaysBetween(workDate, workDate),
  ]);
  const isWeekend = weekendOf(company).includes(new Date(`${workDate}T00:00:00Z`).getUTCDay());
  return {
    workDate,
    shiftLabel: `${formatMinuteOfDay(rule.startMinute)} – ${formatMinuteOfDay(rule.endMinute)}`,
    shiftMinutes: shiftEndOffset(rule) - rule.startMinute,
    signIn: day?.firstIn?.toISOString() ?? null,
    signOut: day?.lastOut?.toISOString() ?? null,
    offDay: holidays.get(workDate) ?? (isWeekend ? "Weekend" : null),
  };
}
