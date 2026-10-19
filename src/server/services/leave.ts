import "server-only";
import { Prisma, type LeaveStatus } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertPermission, can, type Actor } from "@/server/auth/session";
import { canAccessEmployee, scopedEmployeeWhere } from "@/server/auth/scope";
import { recomputeAttendance } from "@/server/services/attendance";
import { isPayrollLockedFor } from "@/server/services/payroll-lock";
import { balanceOf, countLeaveDays, leaveDaysWithin, type Balance } from "@/core/leave/days";
import { parseDateOnly, todayInPKT, toDateOnlyString } from "@/lib/dates";
import { weekendOf } from "@/server/json-fields";
import { holidayDatesBetween } from "@/server/services/holidays";

const iso = (d: Date) => toDateOnlyString(d);
const d0 = (s: string) => new Date(`${s}T00:00:00Z`);

/** Weekly off days plus the public holidays in [from, to] — the days leave never counts. */
async function offDays(from: string, to: string) {
  const [company, holidays] = await Promise.all([db.company.findFirst({ select: { weekendDays: true } }), holidayDatesBetween(from, to)]);
  return { weekend: weekendOf(company), holidays };
}

// ───────────── Leave types ─────────────

export function listLeaveTypes(includeInactive = false) {
  return db.leaveType.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: { name: "asc" } });
}

export async function saveLeaveType(actor: Actor, input: { id?: string; name: string; code?: string; isPaid: boolean; daysPerYear: number | null; isActive: boolean }) {
  assertPermission(actor, "settings.organisation", "all");
  const data = { name: input.name, code: input.code?.toUpperCase() || null, isPaid: input.isPaid, daysPerYear: input.daysPerYear, isActive: input.isActive };
  try {
    const before = input.id ? await db.leaveType.findUnique({ where: { id: input.id } }) : null;
    const after = input.id ? await db.leaveType.update({ where: { id: input.id }, data }) : await db.leaveType.create({ data });
    await recordAudit({ actor, action: input.id ? "leave_type.update" : "leave_type.create", entityType: "LeaveType", entityId: after.id, before, after });
    return after;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError("A leave type with this name or code already exists.");
    throw err;
  }
}

// ───────────── Balances ─────────────

export type LeaveBalance = Balance & { leaveTypeId: string; name: string; isPaid: boolean };

/** Balance per active leave type for a calendar year (approved = used, pending reserved). */
export async function leaveBalances(employeeId: string, year: number): Promise<LeaveBalance[]> {
  const [types, requests, { weekend, holidays }] = await Promise.all([
    listLeaveTypes(),
    db.leaveRequest.findMany({
      where: { employeeId, status: { in: ["APPROVED", "PENDING"] }, startDate: { lte: d0(`${year}-12-31`) }, endDate: { gte: d0(`${year}-01-01`) } },
    }),
    offDays(`${year}-01-01`, `${year}-12-31`),
  ]);
  return types.map((t) => {
    const mine = requests.filter((r) => r.leaveTypeId === t.id);
    const days = (status: LeaveStatus) =>
      mine.filter((r) => r.status === status).reduce((n, r) => n + leaveDaysWithin(iso(r.startDate), iso(r.endDate), `${year}-01-01`, `${year}-12-31`, weekend, holidays), 0);
    return { leaveTypeId: t.id, name: t.name, isPaid: t.isPaid, ...balanceOf(t.daysPerYear, days("APPROVED"), days("PENDING")) };
  });
}

// ───────────── Requests ─────────────

export async function requestLeave(
  actor: Actor,
  input: { employeeId?: string; leaveTypeId: string; startDate: string; endDate: string; reason: string },
) {
  const forSelf = !input.employeeId || input.employeeId === actor.employeeId;
  const employeeId = forSelf ? actor.employeeId : input.employeeId!;
  if (!employeeId) throw new AppError("Your account is not linked to an employee record.");
  if (forSelf) assertPermission(actor, "leave.request", "self");
  else if (!can(actor, "leave.approve", "all")) throw new ForbiddenError("Only HR can record leave for another employee.");

  const start = iso(parseDateOnly(input.startDate));
  const end = iso(parseDateOnly(input.endDate));
  if (end < start) throw new AppError("The end date is before the start date.");
  if (input.reason.trim().length < 3) throw new AppError("Give a reason for the leave.");
  if (Date.parse(end) - Date.parse(start) > 90 * 86_400_000) throw new AppError("A single request can cover at most 90 days.");

  const [employee, type, { weekend, holidays }] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, joiningDate: true, exitDate: true, status: true } }),
    db.leaveType.findUnique({ where: { id: input.leaveTypeId } }),
    offDays(start, end),
  ]);
  if (!employee) throw new NotFoundError("Employee not found.");
  if (!type || !type.isActive) throw new AppError("Choose an active leave type.");
  if (start < iso(employee.joiningDate)) throw new AppError("Leave cannot start before the joining date.");
  if (employee.exitDate && end > iso(employee.exitDate)) throw new AppError("Leave cannot end after the exit date.");

  const days = countLeaveDays(start, end, weekend, holidays);
  if (days === 0) throw new AppError("Those dates are all weekly off days or holidays — no leave is needed.");
  for (const date of [start, end]) {
    if (await isPayrollLockedFor(date)) throw new AppError("Payroll for that month is already approved. Ask HR to record it as a payroll adjustment.");
  }

  const overlap = await db.leaveRequest.findFirst({
    where: { employeeId, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: d0(end) }, endDate: { gte: d0(start) } },
  });
  if (overlap) throw new AppError(`This overlaps an existing ${overlap.status.toLowerCase()} leave (${iso(overlap.startDate)} – ${iso(overlap.endDate)}).`);

  if (type.daysPerYear !== null) {
    for (const year of new Set([start.slice(0, 4), end.slice(0, 4)])) {
      const bal = (await leaveBalances(employeeId, Number(year))).find((b) => b.leaveTypeId === type.id)!;
      const needed = leaveDaysWithin(start, end, `${year}-01-01`, `${year}-12-31`, weekend, holidays);
      if (bal.remaining !== null && needed > bal.remaining) {
        throw new AppError(`Not enough ${type.name} balance for ${year}: ${bal.remaining} day(s) left, ${needed} requested (pending requests count too).`);
      }
    }
  }

  const approvedNow = !forSelf; // HR recording leave on someone's behalf
  const request = await db.leaveRequest.create({
    data: {
      employeeId, leaveTypeId: type.id, startDate: d0(start), endDate: d0(end), days, reason: input.reason.trim(),
      requestedById: actor.userId, status: approvedNow ? "APPROVED" : "PENDING",
      ...(approvedNow ? { decidedById: actor.userId, decidedAt: new Date(), decisionNote: "Recorded by HR" } : {}),
    },
  });
  if (approvedNow) await recomputeAttendance({ employeeIds: [employeeId], from: start, to: end });
  await recordAudit({ actor, action: approvedNow ? "leave.record" : "leave.request", entityType: "Employee", entityId: employeeId, after: { type: type.name, start, end, days } });
  return request;
}

async function loadRequest(id: string) {
  const r = await db.leaveRequest.findUnique({ where: { id }, include: { leaveType: true, employee: { select: { id: true, fullName: true } } } });
  if (!r) throw new NotFoundError("Leave request not found.");
  return r;
}

/** Manager approves their team; HR approves anyone. Nobody approves their own leave. */
export async function decideLeave(actor: Actor, id: string, approve: boolean, note: string) {
  const r = await loadRequest(id);
  if (r.status !== "PENDING") throw new AppError(`This request is already ${r.status.toLowerCase()}.`);
  if (r.employeeId === actor.employeeId) throw new ForbiddenError("You cannot approve your own leave.");
  if (!(await canAccessEmployee(actor, "leave.approve", r.employeeId))) throw new ForbiddenError();
  if (approve) {
    for (const date of [iso(r.startDate), iso(r.endDate)]) {
      if (await isPayrollLockedFor(date)) throw new AppError("Payroll for that month is already approved; record it as a payroll adjustment instead.");
    }
  }
  await db.leaveRequest.update({
    where: { id },
    data: { status: approve ? "APPROVED" : "REJECTED", decidedById: actor.userId, decidedAt: new Date(), decisionNote: note.trim() || null },
  });
  if (approve) await recomputeAttendance({ employeeIds: [r.employeeId], from: iso(r.startDate), to: iso(r.endDate) });
  await recordAudit({
    actor, action: approve ? "leave.approve" : "leave.reject", entityType: "Employee", entityId: r.employeeId,
    after: { type: r.leaveType.name, start: iso(r.startDate), end: iso(r.endDate), days: r.days, note: note.trim() || null },
  });
}

/** The employee cancels their own pending request; HR can also cancel an approved one (attendance is recalculated). */
export async function cancelLeave(actor: Actor, id: string) {
  const r = await loadRequest(id);
  const own = r.employeeId === actor.employeeId;
  const isHr = can(actor, "leave.approve", "all");
  if (r.status === "PENDING" ? !own && !isHr : r.status === "APPROVED" ? !isHr : true) {
    throw new AppError(r.status === "APPROVED" ? "Only HR can cancel approved leave." : "This request can no longer be cancelled.");
  }
  if (r.status === "APPROVED") {
    for (const date of [iso(r.startDate), iso(r.endDate)]) {
      if (await isPayrollLockedFor(date)) throw new AppError("Payroll for that month is approved; this leave can no longer be cancelled.");
    }
  }
  await db.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedById: actor.userId, decidedAt: new Date() } });
  if (r.status === "APPROVED") await recomputeAttendance({ employeeIds: [r.employeeId], from: iso(r.startDate), to: iso(r.endDate) });
  await recordAudit({ actor, action: "leave.cancel", entityType: "Employee", entityId: r.employeeId, after: { type: r.leaveType.name, start: iso(r.startDate), end: iso(r.endDate) } });
}

// ───────────── Lists ─────────────

const requestInclude = {
  leaveType: { select: { name: true, isPaid: true } },
  employee: { select: { id: true, fullName: true, employeeCode: true, department: { select: { name: true } } } },
} satisfies Prisma.LeaveRequestInclude;

export function myLeaveRequests(employeeId: string) {
  return db.leaveRequest.findMany({ where: { employeeId }, include: requestInclude, orderBy: { startDate: "desc" }, take: 50 });
}

/** Pending requests the actor may decide (team for managers, everyone for HR), excluding their own. */
export async function approvalQueue(actor: Actor) {
  if (!can(actor, "leave.approve", "team")) return [];
  const scope = await scopedEmployeeWhere(actor, "leave.approve");
  return db.leaveRequest.findMany({
    where: { status: "PENDING", employee: { AND: [scope, actor.employeeId ? { NOT: { id: actor.employeeId } } : {}] } },
    include: requestInclude,
    orderBy: { startDate: "asc" },
  });
}

export async function allLeaveRequests(actor: Actor, filter: { status?: LeaveStatus; month?: string }) {
  assertPermission(actor, "leave.read", "team");
  const scope = await scopedEmployeeWhere(actor, "leave.read");
  const range = filter.month && /^\d{4}-\d{2}$/.test(filter.month)
    ? { startDate: { lte: d0(iso(new Date(Date.UTC(Number(filter.month.slice(0, 4)), Number(filter.month.slice(5, 7)), 0)))) }, endDate: { gte: d0(`${filter.month}-01`) } }
    : {};
  return db.leaveRequest.findMany({
    where: { employee: scope, ...(filter.status ? { status: filter.status } : {}), ...range },
    include: requestInclude,
    orderBy: { startDate: "desc" },
    take: 200,
  });
}

export async function pendingLeaveCount(actor: Actor) {
  return (await approvalQueue(actor)).length;
}

/** Approved leave dates per employee in a range, split by paid/unpaid — used by attendance and payroll. */
export async function approvedLeaveDates(employeeIds: string[], from: string, to: string) {
  const [rows, { weekend, holidays }] = await Promise.all([
    db.leaveRequest.findMany({
      where: { employeeId: { in: employeeIds }, status: "APPROVED", startDate: { lte: d0(to) }, endDate: { gte: d0(from) } },
      include: { leaveType: { select: { isPaid: true } } },
    }),
    offDays(from, to),
  ]);
  const map = new Map<string, Map<string, boolean>>(); // employeeId → date → isPaid
  for (const r of rows) {
    const m = map.get(r.employeeId) ?? map.set(r.employeeId, new Map()).get(r.employeeId)!;
    for (let t = Math.max(Date.parse(iso(r.startDate)), Date.parse(from)); t <= Math.min(Date.parse(iso(r.endDate)), Date.parse(to)); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (!weekend.includes(new Date(t).getUTCDay()) && !holidays.has(date)) m.set(date, r.leaveType.isPaid);
    }
  }
  return map;
}

export const currentYear = () => todayInPKT().getUTCFullYear();
