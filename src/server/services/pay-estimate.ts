import "server-only";
import { db } from "@/server/db";
import { attendanceDaysForMonth } from "@/server/services/attendance";
import { salaryInForce } from "@/server/services/employees";
import { calculatePay, type AttendanceStatusCode, type PayResult } from "@/core/payroll/calculate";
import { earnedToDate, type EarnedToDate } from "@/core/payroll/earned-to-date";
import { approvedLeaveDates } from "@/server/services/leave";
import { approvedHalfDayDates } from "@/server/services/attendance-requests";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";
import { attendanceStartOf, weekendOf } from "@/server/json-fields";
import { holidayDatesBetween } from "@/server/services/holidays";
import { loanDeductionsFor } from "@/server/services/loans";

export type PayEstimate = PayResult & { earnedToDate: EarnedToDate | null };

/**
 * The month's pay estimate from the payroll engine, before payroll is approved: attendance so far, holidays,
 * unpaid leave and loan installments. The ESS dashboard and the expected payslip PDF both use this, so they match.
 * Returns null for months paid through the previous software (before the attendance start) or without a salary.
 * No access checks: callers decide who may see it.
 */
export async function estimatePayslip(employeeId: string, year: number, month: number): Promise<PayEstimate | null> {
  const today = todayInPKT();
  const todayIso = toDateOnlyString(today);
  const monthStart = toDateOnlyString(new Date(Date.UTC(year, month - 1, 1)));
  const lastDayOfPeriod = new Date(Date.UTC(year, month, 0));
  const monthEnd = toDateOnlyString(lastDayOfPeriod);

  const [employee, company, holidays] = await Promise.all([
    db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { joiningDate: true, exitDate: true } }),
    db.company.findFirst({ select: { weekendDays: true, attendanceStartDate: true } }),
    holidayDatesBetween(monthStart, monthEnd),
  ]);
  const start = attendanceStartOf(company);
  if (start && monthEnd < start) return null;

  const salary = await salaryInForce(employeeId, lastDayOfPeriod < today ? lastDayOfPeriod : today);
  if (!salary) return null;

  const [rows, loans, leaves, halfDays] = await Promise.all([
    attendanceDaysForMonth(employeeId, year, month),
    loanDeductionsFor([employeeId], year, month),
    approvedLeaveDates([employeeId], monthStart, monthEnd),
    approvedHalfDayDates([employeeId], monthStart, monthEnd),
  ]);
  const joiningDate = toDateOnlyString(employee.joiningDate);
  const exitDate = employee.exitDate ? toDateOnlyString(employee.exitDate) : null;
  const result = calculatePay({
    year, month, today: todayIso, joiningDate, exitDate, weekendDays: weekendOf(company), holidays,
    salary: { basic: Number(salary.basicSalary), allowances: salary.allowances.map((a) => ({ name: a.name, amount: Number(a.amount) })) },
    days: new Map(rows.map((r) => [toDateOnlyString(r.workDate), r.status as AttendanceStatusCode])),
    adjustments: [],
    loans: loans.get(employeeId) ?? [],
    unpaidLeaveDates: new Set([...(leaves.get(employeeId) ?? new Map<string, boolean>())].filter(([, paid]) => !paid).map(([d]) => d)),
    approvedHalfDayDates: halfDays.get(employeeId),
  });
  return {
    ...result,
    earnedToDate: earnedToDate({ year, month, today: todayIso, joiningDate, exitDate, perDayRate: result.perDayRate, lines: result.lines }),
  };
}
