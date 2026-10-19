import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { pruneBeforeAttendanceStart, recomputeAttendance } from "@/server/services/attendance";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

function uniqueError(err: unknown, label: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError(`${label} already exists.`);
  throw err;
}

// ───────────── Company ─────────────

export async function getCompany() {
  const company = await db.company.findFirst();
  if (!company) throw new NotFoundError("Company record missing — run the database seed.");
  return company;
}

export async function updateCompany(
  actor: Actor,
  input: { legalName: string; shortName: string; address?: string; phone?: string; email?: string; website?: string; ntn?: string; weekendDays: number[]; attendanceStartDate: string | null },
) {
  assertPermission(actor, "settings.company", "all");
  const before = await getCompany();
  const after = await db.company.update({
    where: { id: before.id },
    data: {
      legalName: input.legalName,
      shortName: input.shortName,
      address: input.address ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      ntn: input.ntn ?? null,
      weekendDays: [...new Set(input.weekendDays)].sort(),
      attendanceStartDate: input.attendanceStartDate ? new Date(`${input.attendanceStartDate}T00:00:00Z`) : null,
    },
  });
  const oldStart = before.attendanceStartDate ? toDateOnlyString(before.attendanceStartDate) : null;
  if (oldStart !== input.attendanceStartDate) {
    // Recalculate from the earliest day that enters or leaves the record (without an old start: all device data).
    const earliest = oldStart ?? (await db.rawPunch.findFirst({ orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }))?.punchedAt;
    const candidates = [earliest ? (typeof earliest === "string" ? earliest : toDateOnlyString(earliest)) : null, input.attendanceStartDate];
    const from = candidates.filter((d): d is string => !!d).sort()[0];
    if (from) await recomputeAttendance({ from, to: toDateOnlyString(todayInPKT()) });
    await pruneBeforeAttendanceStart();
  }
  await recordAudit({ actor, action: "company.update", entityType: "Company", entityId: after.id, before, after });
  return after;
}

// ───────────── Departments ─────────────

export function listDepartments() {
  return db.department.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { employees: { where: { status: "ACTIVE" } } } } } });
}

export async function saveDepartment(actor: Actor, input: { id?: string; name: string; code?: string; description?: string; isActive: boolean }) {
  assertPermission(actor, "settings.organisation", "all");
  const data = { name: input.name, code: input.code?.toUpperCase() ?? null, description: input.description ?? null, isActive: input.isActive };
  try {
    const before = input.id ? await db.department.findUnique({ where: { id: input.id } }) : null;
    const after = input.id ? await db.department.update({ where: { id: input.id }, data }) : await db.department.create({ data });
    await recordAudit({ actor, action: input.id ? "department.update" : "department.create", entityType: "Department", entityId: after.id, before, after });
    return after;
  } catch (err) {
    uniqueError(err, "A department with this name or code");
  }
}

// ───────────── Designations ─────────────

export function listDesignations() {
  return db.designation.findMany({ orderBy: { title: "asc" }, include: { _count: { select: { employees: { where: { status: "ACTIVE" } } } } } });
}

export async function saveDesignation(actor: Actor, input: { id?: string; title: string; isActive: boolean }) {
  assertPermission(actor, "settings.organisation", "all");
  try {
    const before = input.id ? await db.designation.findUnique({ where: { id: input.id } }) : null;
    const data = { title: input.title, isActive: input.isActive };
    const after = input.id ? await db.designation.update({ where: { id: input.id }, data }) : await db.designation.create({ data });
    await recordAudit({ actor, action: input.id ? "designation.update" : "designation.create", entityType: "Designation", entityId: after.id, before, after });
    return after;
  } catch (err) {
    uniqueError(err, "A designation with this title");
  }
}

// ───────────── Shifts ─────────────

export function listShifts() {
  return db.shift.findMany({
    orderBy: { name: "asc" },
    include: { dayOverrides: { orderBy: { weekday: "asc" } }, _count: { select: { employees: { where: { status: "ACTIVE" } } } } },
  });
}

/** After a timing change, recalculate attendance history for everyone on that shift (and on the default shift if unassigned). */
async function recomputeForShift(shiftId: string) {
  const shift = await db.shift.findUnique({ where: { id: shiftId } });
  if (!shift) return;
  const employees = await db.employee.findMany({
    where: { deviceUserId: { not: null }, OR: [{ shiftId }, ...(shift.isDefault ? [{ shiftId: null }] : [])] },
    select: { id: true },
  });
  const earliest = await db.rawPunch.findFirst({ where: { employeeId: { in: employees.map((e) => e.id) } }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } });
  if (employees.length && earliest) {
    await recomputeAttendance({ employeeIds: employees.map((e) => e.id), from: toDateOnlyString(earliest.punchedAt), to: toDateOnlyString(todayInPKT()) });
  }
}

export async function saveShiftOverride(
  actor: Actor,
  input: { shiftId: string; weekday: number; startMinute: number; endMinute: number; graceMinutes: number | null },
) {
  assertPermission(actor, "settings.organisation", "all");
  if (input.startMinute === input.endMinute) throw new AppError("Start and end cannot be the same.");
  if (input.weekday < 0 || input.weekday > 6) throw new AppError("Choose a day of the week.");
  const before = await db.shiftDayOverride.findUnique({ where: { shiftId_weekday: { shiftId: input.shiftId, weekday: input.weekday } } });
  const after = await db.shiftDayOverride.upsert({
    where: { shiftId_weekday: { shiftId: input.shiftId, weekday: input.weekday } },
    create: input,
    update: { startMinute: input.startMinute, endMinute: input.endMinute, graceMinutes: input.graceMinutes },
  });
  await recordAudit({ actor, action: "shift.day_override", entityType: "Shift", entityId: input.shiftId, before, after });
  await recomputeForShift(input.shiftId);
}

export async function deleteShiftOverride(actor: Actor, overrideId: string) {
  assertPermission(actor, "settings.organisation", "all");
  const before = await db.shiftDayOverride.findUnique({ where: { id: overrideId } });
  if (!before) throw new NotFoundError("Day timing not found.");
  await db.shiftDayOverride.delete({ where: { id: overrideId } });
  await recordAudit({ actor, action: "shift.day_override_removed", entityType: "Shift", entityId: before.shiftId, before });
  await recomputeForShift(before.shiftId);
}

export async function saveShift(
  actor: Actor,
  input: { id?: string; name: string; startMinute: number; endMinute: number; graceMinutes: number; isDefault: boolean; isActive: boolean },
) {
  assertPermission(actor, "settings.organisation", "all");
  if (input.startMinute === input.endMinute) throw new AppError("Shift start and end cannot be the same.");
  if (input.isDefault && !input.isActive) throw new AppError("The default shift must be active.");
  let saved;
  try {
    saved = await db.$transaction(async (tx) => {
      if (input.isDefault) await tx.shift.updateMany({ where: { isDefault: true, NOT: input.id ? { id: input.id } : undefined }, data: { isDefault: false } });
      const before = input.id ? await tx.shift.findUnique({ where: { id: input.id } }) : null;
      const { id, ...data } = input;
      const after = id ? await tx.shift.update({ where: { id }, data }) : await tx.shift.create({ data });
      await recordAudit({ actor, action: id ? "shift.update" : "shift.create", entityType: "Shift", entityId: after.id, before, after }, tx);
      return { after, timingChanged: !before || before.startMinute !== after.startMinute || before.endMinute !== after.endMinute || before.graceMinutes !== after.graceMinutes || before.isDefault !== after.isDefault };
    });
  } catch (err) {
    uniqueError(err, "A shift with this name");
  }
  if (saved.timingChanged) await recomputeForShift(saved.after.id);
  return saved.after;
}
