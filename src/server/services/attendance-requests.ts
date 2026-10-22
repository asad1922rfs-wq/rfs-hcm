import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { canAccessEmployee, scopedEmployeeWhere } from "@/server/auth/scope";
import { FALLBACK_SHIFT, recomputeAttendance } from "@/server/services/attendance";
import { isPayrollLockedFor } from "@/server/services/payroll-lock";
import { addDaysIso, ruleForDate } from "@/core/attendance/engine";
import { checkWaiverHours, MAX_WAIVER_NOTE, MONTHLY_WAIVER_LIMIT, requiredShiftMinutes, waiverReasonText, waiverRequestsLeft } from "@/core/attendance/waiver";
import { parseDateOnly, todayInPKT, toDateOnlyString } from "@/lib/dates";
import { attendanceStartOf } from "@/server/json-fields";

const iso = (d: Date) => toDateOnlyString(d);
const d0 = (s: string) => new Date(`${s}T00:00:00Z`);
const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
};

/** Requests left per month ("YYYY-MM") for the given months. */
export async function waiverAllowance(employeeId: string, months: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const month of months) {
    const rows = await db.attendanceRequest.findMany({ where: { employeeId, workDate: monthBounds(month), status: { in: ["PENDING", "APPROVED"] } }, select: { workDate: true, status: true } });
    out[month] = waiverRequestsLeft(rows.map((r) => ({ workDate: iso(r.workDate), status: r.status })), month);
  }
  return out;
}

// ───────────── Write ─────────────

export async function requestLateWaiver(actor: Actor, input: { date: string; reasonKey: string; note?: string }) {
  assertPermission(actor, "attendance.request", "self");
  const employeeId = actor.employeeId;
  if (!employeeId) throw new AppError("Your account is not linked to an employee record.");

  const date = iso(parseDateOnly(input.date));
  const reasonText = waiverReasonText(input.reasonKey);
  if (!reasonText) throw new AppError("Choose a reason.");
  const note = input.note?.trim() || null;
  if (note && note.length > MAX_WAIVER_NOTE) throw new AppError(`Keep the note under ${MAX_WAIVER_NOTE} characters.`);
  if (date > iso(todayInPKT())) throw new AppError("You can only ask about today or an earlier day.");

  const [employee, company] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { joiningDate: true, exitDate: true } }),
    db.company.findFirst({ select: { attendanceStartDate: true } }),
  ]);
  if (!employee) throw new NotFoundError("Employee not found.");
  const start = attendanceStartOf(company);
  if (start && date < start) throw new AppError(`Attendance is tracked in this system from ${start}; earlier days can't be requested.`);
  if (date < iso(employee.joiningDate)) throw new AppError("That date is before your joining date.");
  if (employee.exitDate && date > iso(employee.exitDate)) throw new AppError("That date is after your exit date.");
  if (await isPayrollLockedFor(date)) throw new AppError("Payroll for that month is already approved, so its attendance is locked.");
  if (!(await openRequestMonths()).includes(date.slice(0, 7))) throw new AppError("Requests can only be made for this month or last month (while its payroll is open).");

  const existing = await db.attendanceRequest.findFirst({ where: { employeeId, workDate: d0(date), status: { in: ["PENDING", "APPROVED"] } } });
  if (existing) throw new AppError(`You already have a${existing.status === "APPROVED" ? "n approved" : " pending"} request for this date.`);
  const left = (await waiverAllowance(employeeId, [date.slice(0, 7)]))[date.slice(0, 7)]!;
  if (left <= 0) throw new AppError(`You have used all ${MONTHLY_WAIVER_LIMIT} attendance requests for that month.`);

  const request = await db.attendanceRequest.create({
    data: { employeeId, workDate: d0(date), reasonKey: input.reasonKey, reasonText, note, requestedById: actor.userId },
  });
  await recordAudit({ actor, action: "attendance_request.create", entityType: "AttendanceRequest", entityId: request.id, after: { employeeId, date, reason: reasonText, note } });
  return { request, left: left - 1 };
}

async function loadRequest(id: string) {
  const r = await db.attendanceRequest.findUnique({ where: { id }, include: { employee: { select: { id: true, fullName: true } } } });
  if (!r) throw new NotFoundError("Attendance request not found.");
  return r;
}

/** The day's worked time and the shift length it is judged against (the shift the day was computed on). */
async function dayHours(employeeId: string, date: string) {
  const day = await db.attendanceDay.findUnique({ where: { employeeId_workDate: { employeeId, workDate: d0(date) } } });
  const shift = day?.shiftId ? await db.shift.findUnique({ where: { id: day.shiftId }, include: { dayOverrides: true } }) : null;
  const rule = ruleForDate(shift ? { ...shift, overrides: shift.dayOverrides } : FALLBACK_SHIFT, date);
  return { day, requiredMinutes: requiredShiftMinutes(rule) };
}

/** Manager approves their team; HR approves anyone. Nobody decides their own. Rejecting needs a note. */
export async function decideLateWaiver(actor: Actor, id: string, approve: boolean, note: string) {
  const r = await loadRequest(id);
  if (r.status !== "PENDING") throw new AppError(`This request is already ${r.status.toLowerCase()}.`);
  if (r.employeeId === actor.employeeId) throw new ForbiddenError("You cannot decide your own attendance request.");
  if (!(await canAccessEmployee(actor, "attendance.approve", r.employeeId))) throw new ForbiddenError();
  const date = iso(r.workDate);
  const decisionNote = note.trim() || null;
  if (!approve && (!decisionNote || decisionNote.length < 3)) throw new AppError("Give a reason for rejecting — the employee will see it.");
  if (approve && (await isPayrollLockedFor(date))) throw new AppError("Payroll for that month is already approved, so its attendance is locked. Reject this request instead.");

  const { day, requiredMinutes } = await dayHours(r.employeeId, date);
  const check = checkWaiverHours(day, requiredMinutes);
  if (approve && !check.ok) throw new AppError(check.message);

  await db.attendanceRequest.update({
    where: { id },
    data: {
      status: approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote,
      workedMinutes: check.workedMinutes, requiredMinutes,
    },
  });
  await recomputeAttendance({ employeeIds: [r.employeeId], from: date, to: date });
  await recordAudit({
    actor, action: approve ? "attendance_request.approve" : "attendance_request.reject", entityType: "AttendanceRequest", entityId: id,
    before: { status: day?.status ?? null }, after: { employeeId: r.employeeId, date, workedMinutes: check.workedMinutes, requiredMinutes, note: decisionNote },
  });
}

/** The employee cancels their own pending request. */
export async function cancelLateWaiver(actor: Actor, id: string) {
  const r = await loadRequest(id);
  if (r.employeeId !== actor.employeeId) throw new ForbiddenError("You can only cancel your own request.");
  if (r.status !== "PENDING") throw new AppError("Only a pending request can be cancelled.");
  await db.attendanceRequest.update({ where: { id }, data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: new Date() } });
  await recordAudit({ actor, action: "attendance_request.cancel", entityType: "AttendanceRequest", entityId: id, after: { employeeId: r.employeeId, date: iso(r.workDate) } });
}

// ───────────── Lists ─────────────

const requestInclude = {
  employee: { select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } } },
} satisfies Prisma.AttendanceRequestInclude;

export function myAttendanceRequests(employeeId: string) {
  return db.attendanceRequest.findMany({ where: { employeeId }, include: requestInclude, orderBy: [{ workDate: "desc" }, { createdAt: "desc" }], take: 100 });
}

/** Pending requests the actor may decide (team for managers, everyone for HR), excluding their own, with the day's hours. */
export async function attendanceApprovalQueue(actor: Actor) {
  if (!can(actor, "attendance.approve", "team")) return [];
  const scope = await scopedEmployeeWhere(actor, "attendance.approve");
  const rows = await db.attendanceRequest.findMany({
    where: { status: "PENDING", employee: { AND: [scope, actor.employeeId ? { NOT: { id: actor.employeeId } } : {}] } },
    include: requestInclude,
    orderBy: { workDate: "asc" },
  });
  return Promise.all(
    rows.map(async (r) => {
      const { day, requiredMinutes } = await dayHours(r.employeeId, iso(r.workDate));
      const check = checkWaiverHours(day, requiredMinutes);
      return {
        ...r,
        day: day ? { status: day.status, firstIn: day.firstIn, lastOut: day.lastOut, workedMinutes: day.workedMinutes, lateMinutes: day.lateMinutes } : null,
        requiredMinutes,
        blockedReason: check.ok ? null : check.message,
      };
    }),
  );
}

export async function pendingAttendanceRequestCount(actor: Actor) {
  if (!can(actor, "attendance.approve", "team")) return 0;
  const scope = await scopedEmployeeWhere(actor, "attendance.approve");
  return db.attendanceRequest.count({ where: { status: "PENDING", employee: { AND: [scope, actor.employeeId ? { NOT: { id: actor.employeeId } } : {}] } } });
}

/** Months an employee can currently request for: this month and last month, unless payroll has locked them. */
export async function openRequestMonths(): Promise<string[]> {
  const today = iso(todayInPKT());
  const months = [today.slice(0, 7), addDaysIso(`${today.slice(0, 7)}-01`, -1).slice(0, 7)];
  const open: string[] = [];
  for (const m of months) if (!(await isPayrollLockedFor(`${m}-01`))) open.push(m);
  return open;
}
