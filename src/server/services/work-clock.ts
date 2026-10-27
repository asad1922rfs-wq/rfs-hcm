import "server-only";
import { db } from "@/server/db";
import { flexibleWorkDateOf, FLEXIBLE_MIN_WORK_MINUTES, ruleForDate, shiftEndOffset, workDateOf, type DayAwareShift } from "@/core/attendance/engine";
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
  /** Remote (work from home) employee: signs in and out from the dashboard. */
  remote: boolean;
  /** Flexible hours (remote): no shift timing, shiftMinutes is the 9h daily minimum. */
  flexible: boolean;
  /** The 9h minimum applies today (on or after the flexible-hours date): signing out early marks a Short day. */
  minimumApplies: boolean;
};

/** Today's sign-in/out for the employee's current work day (a 3 PM–12 AM shift still counts at 12:30 AM). */
export async function todayWorkClock(employeeId: string): Promise<WorkClock | null> {
  const [employee, defaultShift, company] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { workMode: true, flexibleFrom: true, shift: { include: { dayOverrides: true } } } }),
    db.shift.findFirst({ where: { isDefault: true, isActive: true }, include: { dayOverrides: true } }),
    db.company.findFirst({ select: { weekendDays: true } }),
  ]);
  const s = employee?.shift ?? defaultShift;
  if (!s) return null;
  const shift: DayAwareShift = { ...s, overrides: s.dayOverrides };
  const now = new Date();
  const remote = employee?.workMode === "REMOTE";
  // Remote: the work day opened by a sign-in in the last 20 hours, as the attendance engine groups it.
  const recent = remote
    ? await db.rawPunch.findMany({ where: { employeeId, punchedAt: { gte: new Date(now.getTime() - 2 * 86_400_000), lte: now } }, select: { punchedAt: true } })
    : [];
  const workDate = remote ? flexibleWorkDateOf(now, recent.map((p) => p.punchedAt)) : workDateOf(now, shift);
  const rule = ruleForDate(shift, workDate);
  // Remote employees never see shift timing; the 9h minimum is enforced from their flexible-hours date.
  const flexible = remote;
  const minimumApplies = remote && !!employee?.flexibleFrom && workDate >= employee.flexibleFrom.toISOString().slice(0, 10);
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
    shiftLabel: flexible ? "Flexible hours, 9h minimum" : `${formatMinuteOfDay(rule.startMinute)} – ${formatMinuteOfDay(rule.endMinute)}`,
    shiftMinutes: flexible ? FLEXIBLE_MIN_WORK_MINUTES : shiftEndOffset(rule) - rule.startMinute,
    signIn: day?.firstIn?.toISOString() ?? null,
    signOut: day?.lastOut?.toISOString() ?? null,
    offDay: holidays.get(workDate) ?? (isWeekend ? "Weekend" : null),
    remote,
    flexible,
    minimumApplies,
  };
}
