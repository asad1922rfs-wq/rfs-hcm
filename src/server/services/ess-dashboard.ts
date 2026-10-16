import "server-only";
import { db } from "@/server/db";
import { can, type Actor } from "@/server/auth/session";
import { canAccessEmployee, scopedEmployeeWhere } from "@/server/auth/scope";
import { attendanceDaysForMonth, attendanceSyncStatus } from "@/server/services/attendance";
import { salaryInForce } from "@/server/services/employees";
import { buildMonthCalendar, summariseMonth, type DayRecord } from "@/core/attendance/month-calendar";
import type { DayStatus } from "@/core/attendance/day-status";
import { localTime } from "@/server/services/attendance-edit";
import { to12h } from "@/lib/format";
import { calculatePay, type AttendanceStatusCode, type PayLine } from "@/core/payroll/calculate";
import { employeePayHistory } from "@/server/services/payroll";
import { approvedLeaveDates, leaveBalances, pendingLeaveCount } from "@/server/services/leave";
import { nextAnniversary, todayInPKT, toDateOnlyString, yearsBetween } from "@/lib/dates";

/** "2:05 PM", or "12:30 AM (next day)" for an after-midnight check-out. */
function clockLabel(instant: Date | null, workDate: string): string | null {
  const t = localTime(instant, workDate);
  return t ? `${to12h(t.time)}${t.nextDay ? " (next day)" : ""}` : null;
}

export type EssPeriod = "current" | "previous";


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
    rows.map((r) => {
      const date = toDateOnlyString(r.workDate);
      return [date, { status: r.status as DayStatus, workedMinutes: r.workedMinutes, signIn: clockLabel(r.firstIn, date), signOut: clockLabel(r.lastOut, date) }];
    }),
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

  // Pay for the month: the approved payroll if there is one, otherwise an estimate from the same payroll engine.
  let payslip: null | { itemId: string | null; status: "ESTIMATE" | "APPROVED" | "PAID"; netPay: number; gross: number; perDayRate: number; daysInMonth: number; lines: PayLine[]; warnings: string[] } = null;
  let payHistory: { id: string; label: string; netPay: number; status: string }[] = [];
  if (await canAccessEmployee(actor, "salary.read", employee.id)) {
    const history = await employeePayHistory(employee.id);
    payHistory = history.map((h) => ({ id: h.id, label: h.label, netPay: Number(h.netPay), status: h.run.status }));
    const approved = history.find((h) => h.run.year === year && h.run.month === month);
    if (approved) {
      payslip = {
        itemId: approved.id,
        status: approved.run.status === "PAID" ? "PAID" : "APPROVED", netPay: Number(approved.netPay), gross: Number(approved.grossSalary),
        perDayRate: Number(approved.perDayRate), daysInMonth: approved.daysInMonth, lines: approved.lines as PayLine[], warnings: approved.warnings,
      };
    } else {
      const salary = await salaryInForce(employee.id, lastDayOfPeriod < today ? lastDayOfPeriod : today);
      const r = calculatePay({
        year, month, today: todayIso, joiningDate: toDateOnlyString(employee.joiningDate),
        exitDate: employee.exitDate ? toDateOnlyString(employee.exitDate) : null, weekendDays: company?.weekendDays ?? [0, 6],
        salary: salary ? { basic: Number(salary.basicSalary), allowances: salary.allowances.map((a) => ({ name: a.name, amount: Number(a.amount) })) } : null,
        days: new Map(rows.map((r) => [toDateOnlyString(r.workDate), r.status as AttendanceStatusCode])),
        adjustments: [],
        unpaidLeaveDates: new Set([...((await approvedLeaveDates([employee.id], toDateOnlyString(new Date(Date.UTC(year, month - 1, 1))), toDateOnlyString(lastDayOfPeriod))).get(employee.id) ?? new Map<string, boolean>())].filter(([, paid]) => !paid).map(([d]) => d)),
      });
      if (salary) payslip = { itemId: null, status: "ESTIMATE", netPay: r.netPay, gross: r.gross, perDayRate: r.perDayRate, daysInMonth: r.daysInMonth, lines: r.lines, warnings: r.warnings };
    }
  }

  const [leave, myRequests, approvals] = await Promise.all([
    leaveBalances(employee.id, today.getUTCFullYear()),
    db.leaveRequest.groupBy({ by: ["status"], where: { employeeId: employee.id, startDate: { gte: new Date(Date.UTC(today.getUTCFullYear(), 0, 1)) } }, _count: { _all: true } }),
    pendingLeaveCount(actor),
  ]);
  const requestCount = (s: string) => myRequests.find((r) => r.status === s)?._count._all ?? 0;

  return {
    leave,
    leaveRequests: { pending: requestCount("PENDING"), approved: requestCount("APPROVED") },
    pendingApprovals: approvals,
    subject: {
      ...employee,
      isSelf: employee.id === actor.employeeId,
      birthdayToday,
      anniversaryYears,
      calendar,
      summary,
      summaryUntil,
      payslip,
      payHistory,
    },
    employeeOptions,
    canPickEmployee,
    period,
    year,
    month,
    sync,
  };
}
