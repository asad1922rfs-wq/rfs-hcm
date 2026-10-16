import "server-only";
import { db } from "@/server/db";
import { can, type Actor } from "@/server/auth/session";
import { canAccessEmployee, scopedEmployeeWhere } from "@/server/auth/scope";
import { attendanceDaysForMonth, attendanceSyncStatus } from "@/server/services/attendance";
import { salaryInForce } from "@/server/services/employees";
import { buildMonthCalendar, summariseMonth, type DayRecord } from "@/core/attendance/month-calendar";
import type { DayStatus } from "@/core/attendance/day-status";
import { daysInMonth, nextAnniversary, todayInPKT, toDateOnlyString, yearsBetween } from "@/lib/dates";

export type EssPeriod = "current" | "previous";

/** Confirmed RFS rule: every 3 late arrivals in a month = 1 day's deduction. */
const LATES_PER_DEDUCTION_DAY = 3;

export async function getEssDashboard(actor: Actor, opts: { employeeId?: string; period?: EssPeriod }) {
  const today = todayInPKT();
  const todayIso = toDateOnlyString(today);

  // Who the dashboard is about: the requested employee if the viewer may see their attendance, else the viewer.
  let subjectId = actor.employeeId;
  if (opts.employeeId && opts.employeeId !== actor.employeeId && (await canAccessEmployee(actor, "attendance.read", opts.employeeId))) {
    subjectId = opts.employeeId;
  }

  const canPickEmployee = can(actor, "attendance.read", "team");
  const employeeOptions = canPickEmployee
    ? await db.employee.findMany({
        where: { AND: [await scopedEmployeeWhere(actor, "attendance.read"), { status: "ACTIVE" }] },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, employeeCode: true, deviceUserId: true },
      })
    : [];
  if (!subjectId) subjectId = employeeOptions[0]?.id ?? null;

  const period = opts.period ?? "current";
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (period === "previous" ? 1 : 0), 1));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const sync = await attendanceSyncStatus();

  if (!subjectId) return { subject: null, employeeOptions, canPickEmployee, period, year, month, sync };

  const employee = await db.employee.findUniqueOrThrow({
    where: { id: subjectId },
    select: {
      id: true, fullName: true, employeeCode: true, photoPath: true, dateOfBirth: true, joiningDate: true, exitDate: true, deviceUserId: true,
      designation: { select: { title: true } }, department: { select: { name: true } },
    },
  });
  const company = await db.company.findFirst({ select: { weekendDays: true } });

  const rows = await attendanceDaysForMonth(employee.id, year, month);
  const records = new Map<string, DayRecord>(
    rows.map((r) => [toDateOnlyString(r.workDate), { status: r.status as DayStatus, workedMinutes: r.workedMinutes }]),
  );
  const calendar = buildMonthCalendar({
    year, month, today: todayIso, weekendDays: company?.weekendDays ?? [0, 6],
    joiningDate: toDateOnlyString(employee.joiningDate),
    exitDate: employee.exitDate ? toDateOnlyString(employee.exitDate) : null,
    records,
  });
  const summary = summariseMonth(calendar, todayIso);
  const lastDayOfPeriod = new Date(Date.UTC(year, month, 0));
  const summaryUntil = todayIso < toDateOnlyString(lastDayOfPeriod) ? todayIso : toDateOnlyString(lastDayOfPeriod);

  const birthdayToday = !!employee.dateOfBirth && nextAnniversary(employee.dateOfBirth, today).getTime() === today.getTime();
  const anniversary = nextAnniversary(employee.joiningDate, today);
  const anniversaryYears = anniversary.getTime() === today.getTime() ? yearsBetween(employee.joiningDate, today) : 0;

  // Expected salary — an estimate from confirmed rules only, shown until payroll is finalised.
  let payslip: null | {
    gross: number; perDay: number; daysInMonth: number; lateCount: number; lateDeductionDays: number; lateDeduction: number;
    absentDays: number; absentDeduction: number; estimatedNet: number;
  } = null;
  if (await canAccessEmployee(actor, "salary.read", employee.id)) {
    const salary = await salaryInForce(employee.id, lastDayOfPeriod < today ? lastDayOfPeriod : today);
    if (salary) {
      const gross = Number(salary.basicSalary) + salary.allowances.reduce((s, a) => s + Number(a.amount), 0);
      const dim = daysInMonth(year, month);
      const perDay = gross / dim;
      const lateDeductionDays = Math.floor(summary.late / LATES_PER_DEDUCTION_DAY);
      const lateDeduction = Math.round(lateDeductionDays * perDay * 100) / 100;
      // Confirmed RFS rule: each absent day deducts one full day. "Not synced" days are never deducted.
      const absentDeduction = Math.round(summary.absent * perDay * 100) / 100;
      payslip = {
        gross, perDay, daysInMonth: dim, lateCount: summary.late, lateDeductionDays, lateDeduction,
        absentDays: summary.absent, absentDeduction, estimatedNet: Math.max(0, gross - lateDeduction - absentDeduction),
      };
    }
  }

  return {
    subject: {
      ...employee,
      isSelf: employee.id === actor.employeeId,
      birthdayToday,
      anniversaryYears,
      calendar,
      summary,
      summaryUntil,
      payslip,
    },
    employeeOptions,
    canPickEmployee,
    period,
    year,
    month,
    sync,
  };
}
