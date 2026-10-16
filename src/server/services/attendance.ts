import "server-only";
import type { AttendanceStatus, Prisma, PunchSource } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { addDaysIso, applyAdjustment, computeDay, localMidnight, ruleForDate, workDateOf, type DayAwareShift } from "@/core/attendance/engine";
import { parsePunchFile, type ParsedPunch } from "@/core/attendance/punch-parser";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Fallback when an employee has no shift and no default shift exists. */
const FALLBACK_SHIFT: DayAwareShift = { startMinute: 14 * 60, endMinute: 23 * 60, graceMinutes: 15 };

// ───────────── Import ─────────────

export async function importPunchFile(actor: Actor, file: File) {
  assertPermission(actor, "attendance.manage", "all");
  if (file.size === 0) throw new AppError("The file is empty.");
  if (file.size > MAX_IMPORT_BYTES) throw new AppError("The file is larger than 10 MB. Split it into smaller date ranges.");

  const parsed = parsePunchFile(await file.text());
  if (parsed.punches.length === 0) {
    throw new AppError(parsed.errors[0] ?? "No attendance punches were found in this file.");
  }

  const employees = await db.employee.findMany({ where: { deviceUserId: { not: null } }, select: { id: true, deviceUserId: true } });
  const byDeviceUser = new Map(employees.map((e) => [e.deviceUserId!, e.id]));

  const times = parsed.punches.map((p) => p.punchedAt.getTime());
  const firstPunchAt = new Date(Math.min(...times));
  const lastPunchAt = new Date(Math.max(...times));

  const batch = await db.punchImport.create({
    data: {
      fileName: file.name.slice(0, 200),
      format: parsed.format,
      uploadedById: actor.userId,
      rowsRead: parsed.punches.length + parsed.invalid,
      inserted: 0,
      duplicates: 0,
      unmatched: 0,
      invalid: parsed.invalid,
      firstPunchAt,
      lastPunchAt,
    },
  });

  const { inserted, unmatchedIds } = await ingestPunches(parsed.punches, "IMPORT", { importId: batch.id, byDeviceUser });
  const result = await db.punchImport.update({
    where: { id: batch.id },
    data: { inserted, duplicates: parsed.punches.length - inserted, unmatched: unmatchedIds.length },
  });

  await recordAudit({ actor, action: "attendance.import", entityType: "PunchImport", entityId: batch.id, after: { ...result, unmatchedIds: unmatchedIds.slice(0, 50) } });
  return { ...result, unmatchedIds, errors: parsed.errors };
}

/**
 * Store raw punches (duplicates are skipped by the unique key), link them to employees by biometric user ID,
 * and recalculate attendance for the affected dates. Shared by file imports and the sync agent.
 */
export async function ingestPunches(
  punches: readonly ParsedPunch[],
  source: PunchSource,
  opts: { importId?: string; byDeviceUser?: Map<string, string> } = {},
): Promise<{ inserted: number; unmatchedIds: string[] }> {
  if (punches.length === 0) return { inserted: 0, unmatchedIds: [] };
  let byDeviceUser = opts.byDeviceUser;
  if (!byDeviceUser) {
    const employees = await db.employee.findMany({ where: { deviceUserId: { not: null } }, select: { id: true, deviceUserId: true } });
    byDeviceUser = new Map(employees.map((e) => [e.deviceUserId!, e.id]));
  }

  let inserted = 0;
  const CHUNK = 2000;
  for (let i = 0; i < punches.length; i += CHUNK) {
    const res = await db.rawPunch.createMany({
      data: punches.slice(i, i + CHUNK).map((p) => ({
        source,
        deviceSerial: p.deviceSerial,
        deviceUserId: p.deviceUserId,
        punchedAt: p.punchedAt,
        deviceLocal: p.local,
        punchState: p.punchState,
        verifyMode: p.verifyMode,
        employeeId: byDeviceUser.get(p.deviceUserId) ?? null,
        importId: opts.importId ?? null,
      })),
      skipDuplicates: true,
    });
    inserted += res.count;
  }

  if (inserted > 0) {
    const times = punches.map((p) => p.punchedAt.getTime());
    await recomputeAttendance({
      from: addDaysIso(toDateOnlyString(new Date(Math.min(...times))), -1),
      to: toDateOnlyString(new Date(Math.max(...times))),
    });
  }
  const unmatchedIds = [...new Set(punches.filter((p) => !byDeviceUser.has(p.deviceUserId)).map((p) => p.deviceUserId))];
  return { inserted, unmatchedIds };
}

/** Attach previously unmatched punches when an employee's biometric user ID is set or changed. */
export async function relinkEmployeePunches(employeeId: string, deviceUserId: string | null) {
  await db.rawPunch.updateMany({ where: { employeeId, ...(deviceUserId ? { NOT: { deviceUserId } } : {}) }, data: { employeeId: null } });
  if (!deviceUserId) {
    await db.attendanceDay.deleteMany({ where: { employeeId } });
    return;
  }
  await db.rawPunch.updateMany({ where: { deviceUserId, employeeId: null }, data: { employeeId } });
  const range = await db.rawPunch.aggregate({ where: { employeeId }, _min: { punchedAt: true }, _max: { punchedAt: true } });
  if (range._min.punchedAt && range._max.punchedAt) {
    await recomputeAttendance({
      employeeIds: [employeeId],
      from: addDaysIso(toDateOnlyString(range._min.punchedAt), -1),
      to: toDateOnlyString(range._max.punchedAt),
    });
  }
}

// ───────────── Recalculation ─────────────

/**
 * Recalculate AttendanceDay rows for [from, to] (inclusive work dates).
 * A working day with no punches is ABSENT only when device data exists for a later date
 * (so we know that day has been synced); otherwise no row is stored and the day shows as "not synced".
 */
export async function recomputeAttendance(opts: { from: string; to: string; employeeIds?: string[] }) {
  const today = toDateOnlyString(todayInPKT());
  const to = opts.to > today ? today : opts.to;
  if (opts.from > to) return;

  const [company, defaultShift, employees, latestPunch, earliestPunch] = await Promise.all([
    db.company.findFirst({ select: { weekendDays: true } }),
    db.shift.findFirst({ where: { isDefault: true, isActive: true }, include: { dayOverrides: true } }),
    db.employee.findMany({
      where: { deviceUserId: { not: null }, ...(opts.employeeIds ? { id: { in: opts.employeeIds } } : {}) },
      select: { id: true, joiningDate: true, exitDate: true, shift: { include: { dayOverrides: true } } },
    }),
    db.rawPunch.findFirst({ orderBy: { punchedAt: "desc" }, select: { punchedAt: true } }),
    db.rawPunch.findFirst({ orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }),
  ]);
  const weekendDays = company?.weekendDays ?? [0, 6];
  // Device data covers [syncedFrom, syncedThrough]; only inside that range can a day without punches be an absence.
  const syncedThrough = latestPunch ? toDateOnlyString(latestPunch.punchedAt) : null;
  const syncedFrom = earliestPunch ? toDateOnlyString(earliestPunch.punchedAt) : null;
  if (employees.length === 0) return;

  const punches = await db.rawPunch.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      punchedAt: { gte: localMidnight(addDaysIso(opts.from, -1)), lt: localMidnight(addDaysIso(to, 2)) },
    },
    select: { employeeId: true, punchedAt: true },
  });

  const adjustmentRows = await db.attendanceAdjustment.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      workDate: { gte: new Date(`${opts.from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
    },
    select: { employeeId: true, workDate: true, checkIn: true, checkOut: true, excused: true },
  });
  const adjustments = new Map(adjustmentRows.map((a) => [`${a.employeeId}|${toDateOnlyString(a.workDate)}`, a]));

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const emp of employees) {
    const s = emp.shift ?? defaultShift;
    const shift: DayAwareShift = s ? { ...s, overrides: s.dayOverrides } : FALLBACK_SHIFT;
    const byDate = new Map<string, Date[]>();
    for (const p of punches) {
      if (p.employeeId !== emp.id) continue;
      const wd = workDateOf(p.punchedAt, shift);
      (byDate.get(wd) ?? byDate.set(wd, []).get(wd)!).push(p.punchedAt);
    }

    const joining = toDateOnlyString(emp.joiningDate);
    const exit = emp.exitDate ? toDateOnlyString(emp.exitDate) : null;
    for (let date = opts.from; date <= to; date = addDaysIso(date, 1)) {
      const workDate = new Date(`${date}T00:00:00Z`);
      const key = { employeeId_workDate: { employeeId: emp.id, workDate } };
      if (date < joining || (exit && date > exit)) {
        writes.push(db.attendanceDay.deleteMany({ where: { employeeId: emp.id, workDate } }));
        continue;
      }
      const isOffDay = weekendDays.includes(workDate.getUTCDay());
      const adj = adjustments.get(`${emp.id}|${date}`);
      const machine = byDate.get(date) ?? [];
      const effective = adj ? applyAdjustment(machine, adj) : machine;
      // An adjusted day is never "in progress": the corrected times are taken as final.
      let result = computeDay(date, effective, ruleForDate(shift, date), isOffDay, date === today && !adj);
      // Company-sanctioned day (work from home, load-shedding early off): present, never late or early.
      if (result && adj?.excused) result = { ...result, status: "PRESENT", lateMinutes: 0, earlyLeaveMinutes: 0 };
      // Only an adjusted check-out (no sign-in at all): record it as the check-out, not the check-in.
      const onlyCheckOut = !!(result && adj?.checkOut && !adj.checkIn && effective.length === 1);

      let data: Omit<Prisma.AttendanceDayUncheckedCreateInput, "employeeId" | "workDate"> | null = null;
      if (result) {
        data = {
          ...result, ...(onlyCheckOut ? { firstIn: null, lastOut: adj!.checkOut } : {}), status: result.status as AttendanceStatus, isOffDay, isAdjusted: !!adj,
          shiftId: emp.shift?.id ?? defaultShift?.id ?? null, computedAt: new Date(),
        };
      } else if (!isOffDay && date < today && syncedFrom && syncedThrough && date >= syncedFrom && date < syncedThrough) {
        data = {
          status: "ABSENT", firstIn: null, lastOut: null, punchCount: 0, workedMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0,
          isOffDay, isAdjusted: false, shiftId: emp.shift?.id ?? defaultShift?.id ?? null, computedAt: new Date(),
        };
      }

      writes.push(
        data
          ? db.attendanceDay.upsert({ where: key, create: { employeeId: emp.id, workDate, ...data }, update: data })
          : db.attendanceDay.deleteMany({ where: { employeeId: emp.id, workDate } }),
      );
    }
  }

  for (let i = 0; i < writes.length; i += 500) await db.$transaction(writes.slice(i, i + 500));
}

// ───────────── Reads ─────────────

export async function attendanceDaysForMonth(employeeId: string, year: number, month: number) {
  return db.attendanceDay.findMany({
    where: { employeeId, workDate: { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) } },
    orderBy: { workDate: "asc" },
  });
}

export async function attendanceSyncStatus() {
  const [lastPunch, lastImport, unmatched] = await Promise.all([
    db.rawPunch.findFirst({ orderBy: { punchedAt: "desc" }, select: { punchedAt: true } }),
    db.punchImport.findFirst({ orderBy: { createdAt: "desc" } }),
    db.rawPunch.groupBy({ by: ["deviceUserId"], where: { employeeId: null }, _count: { _all: true }, _max: { punchedAt: true } }),
  ]);
  return { lastPunchAt: lastPunch?.punchedAt ?? null, lastImport, unmatched };
}

export function recentImports(limit = 20) {
  return db.punchImport.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
