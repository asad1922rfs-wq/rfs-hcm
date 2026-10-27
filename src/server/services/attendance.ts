import "server-only";
import type { AttendanceStatus, Prisma, PunchSource } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { addDaysIso, applyAdjustment, computeDay, computeFlexibleDay, excuseAdjusted, FLEXIBLE_DAY_SPAN_MIN, groupFlexiblePunches, localMidnight, ruleForDate, workDateOf, type DayAwareShift } from "@/core/attendance/engine";
import { parsePunchFile, type ParsedPunch } from "@/core/attendance/punch-parser";
import { applyLateWaiver } from "@/core/attendance/waiver";
import { pktLocalString, webPunchBlockReason, webPunchDeviceUserId } from "@/core/attendance/web-punch";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";
import { attendanceStartOf, trackedFrom, weekendOf } from "@/server/json-fields";
import { holidayDatesBetween } from "@/server/services/holidays";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Fallback when an employee has no shift and no default shift exists. */
export const FALLBACK_SHIFT: DayAwareShift = { startMinute: 14 * 60, endMinute: 23 * 60, graceMinutes: 15 };

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

const RECENT_DAYS = 7;

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

  // Recalculate even when every punch was a duplicate: a retried upload means the earlier recalculation may
  // have been cut off (e.g. by an app restart). The last RECENT_DAYS are always included, so any interrupted
  // recalculation heals on the next punch.
  const times = punches.map((p) => p.punchedAt.getTime());
  const today = toDateOnlyString(todayInPKT());
  const batchFrom = addDaysIso(toDateOnlyString(new Date(Math.min(...times))), -1);
  const recentFrom = addDaysIso(today, -RECENT_DAYS);
  const batchTo = toDateOnlyString(new Date(Math.max(...times)));
  await recomputeAttendance({
    from: batchFrom < recentFrom ? batchFrom : recentFrom,
    to: batchTo > today ? batchTo : today,
  });
  const unmatchedIds = [...new Set(punches.filter((p) => !byDeviceUser.has(p.deviceUserId)).map((p) => p.deviceUserId))];
  return { inserted, unmatchedIds };
}

/** Attach previously unmatched punches when an employee's biometric user ID is set or changed. */
export async function relinkEmployeePunches(employeeId: string, deviceUserId: string | null) {
  // Web sign-ins belong to the employee whatever their biometric ID, so they stay linked.
  await db.rawPunch.updateMany({ where: { employeeId, source: { not: "WEB" }, ...(deviceUserId ? { NOT: { deviceUserId } } : {}) }, data: { employeeId: null } });
  if (!deviceUserId) await db.attendanceDay.deleteMany({ where: { employeeId } });
  else await db.rawPunch.updateMany({ where: { deviceUserId, employeeId: null, source: { not: "WEB" } }, data: { employeeId } });
  const range = await db.rawPunch.aggregate({ where: { employeeId }, _min: { punchedAt: true }, _max: { punchedAt: true } });
  if (range._min.punchedAt && range._max.punchedAt) {
    await recomputeAttendance({
      employeeIds: [employeeId],
      from: addDaysIso(toDateOnlyString(range._min.punchedAt), -1),
      to: toDateOnlyString(range._max.punchedAt),
    });
  }
}

// ───────────── Web sign in / out (remote employees) ─────────────

/**
 * Record a sign-in or sign-out from the dashboard at the server's current time. The first punch of the work day
 * is the check-in and the last the check-out, exactly as with machine punches.
 */
export async function recordWebPunch(actor: Actor) {
  if (!actor.employeeId) throw new AppError("Your account is not linked to an employee record.");
  const employee = await db.employee.findUnique({
    where: { id: actor.employeeId },
    select: { id: true, workMode: true, status: true, deviceUserId: true },
  });
  if (!employee) throw new AppError("Your employee record was not found.");
  const now = new Date();
  const last = await db.rawPunch.findFirst({ where: { employeeId: employee.id }, orderBy: { punchedAt: "desc" }, select: { punchedAt: true } });
  const blocked = webPunchBlockReason(employee, last && last.punchedAt <= now ? last.punchedAt : null, now);
  if (blocked) throw new AppError(blocked);

  const punchedAt = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const punch = await db.rawPunch.create({
    data: {
      source: "WEB",
      deviceSerial: "WEB",
      deviceUserId: webPunchDeviceUserId(employee),
      punchedAt,
      deviceLocal: pktLocalString(punchedAt),
      employeeId: employee.id,
    },
  });
  const date = toDateOnlyString(todayInPKT(punchedAt));
  await recomputeAttendance({ employeeIds: [employee.id], from: addDaysIso(date, -1), to: date });
  await recordAudit({ actor, action: "attendance.web_punch", entityType: "RawPunch", entityId: punch.id, after: { employeeId: employee.id, punchedAt } });
  return { punchedAt };
}

// ───────────── Recalculation ─────────────

/**
 * Recalculate AttendanceDay rows for [from, to] (inclusive work dates).
 * A working day with no punches is ABSENT only when device data exists for a later date
 * (so we know that day has been synced); otherwise no row is stored and the day shows as "not synced".
 */
/** Remove attendance records before the company's attendance start (machine punches are kept). */
export async function pruneBeforeAttendanceStart() {
  const start = attendanceStartOf(await db.company.findFirst({ select: { attendanceStartDate: true } }));
  if (!start) return 0;
  const { count } = await db.attendanceDay.deleteMany({ where: { workDate: { lt: new Date(`${start}T00:00:00Z`) } } });
  return count;
}

export async function recomputeAttendance(opts: { from: string; to: string; employeeIds?: string[] }) {
  const today = toDateOnlyString(todayInPKT());
  const to = opts.to > today ? today : opts.to;
  if (opts.from > to) return;

  const [company, holidays, defaultShift, employees, latestPunch, earliestPunch] = await Promise.all([
    db.company.findFirst({ select: { weekendDays: true, attendanceStartDate: true } }),
    holidayDatesBetween(opts.from, to),
    db.shift.findFirst({ where: { isDefault: true, isActive: true }, include: { dayOverrides: true } }),
    db.employee.findMany({
      // Remote employees may have no biometric ID — their web sign-ins are linked directly.
      where: { OR: [{ deviceUserId: { not: null } }, { workMode: "REMOTE" }], ...(opts.employeeIds ? { id: { in: opts.employeeIds } } : {}) },
      select: { id: true, joiningDate: true, exitDate: true, workMode: true, flexibleFrom: true, shift: { include: { dayOverrides: true } } },
    }),
    // Device coverage comes from machine punches only: one remote sign-in does not mean the device has synced.
    db.rawPunch.findFirst({ where: { source: { not: "WEB" } }, orderBy: { punchedAt: "desc" }, select: { punchedAt: true } }),
    db.rawPunch.findFirst({ where: { source: { not: "WEB" } }, orderBy: { punchedAt: "asc" }, select: { punchedAt: true } }),
  ]);
  const weekendDays = weekendOf(company);
  const start = attendanceStartOf(company);
  // Device data covers [syncedFrom, syncedThrough]; only inside that range can a day without punches be an absence.
  const syncedThrough = latestPunch ? toDateOnlyString(latestPunch.punchedAt) : null;
  const syncedFrom = earliestPunch ? trackedFrom(toDateOnlyString(earliestPunch.punchedAt), start) : null;
  if (employees.length === 0) return;

  const punches = await db.rawPunch.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      // Two days back: a remote work day opened by an earlier sign-in can reach into the first recomputed date.
      punchedAt: { gte: localMidnight(addDaysIso(opts.from, -2)), lt: localMidnight(addDaysIso(to, 2)) },
    },
    select: { employeeId: true, punchedAt: true },
  });

  const adjustmentRows = await db.attendanceAdjustment.findMany({
    where: {
      employeeId: { in: employees.map((e) => e.id) },
      // The day before too: a shift chosen for it can pull that night's late check-out back onto it.
      workDate: { gte: new Date(`${addDaysIso(opts.from, -1)}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
    },
    select: {
      employeeId: true, workDate: true, checkIn: true, checkOut: true, excused: true, category: true,
      shift: { include: { dayOverrides: true } },
    },
  });
  // Approved leave (working days only): shown as LEAVE when there are no punches that day.
  const leaveRows = await db.leaveRequest.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, status: "APPROVED", startDate: { lte: new Date(`${to}T00:00:00Z`) }, endDate: { gte: new Date(`${opts.from}T00:00:00Z`) } },
    select: { employeeId: true, startDate: true, endDate: true },
  });
  const onLeave = (employeeId: string, date: string) =>
    leaveRows.some((l) => l.employeeId === employeeId && toDateOnlyString(l.startDate) <= date && toDateOnlyString(l.endDate) >= date);

  // Approved late waivers (attendance requests): that day's Late counts as Present.
  const waiverRows = await db.attendanceRequest.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, status: "APPROVED", workDate: { gte: new Date(`${opts.from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    select: { employeeId: true, workDate: true },
  });
  const waived = new Set(waiverRows.map((w) => `${w.employeeId}|${toDateOnlyString(w.workDate)}`));

  const adjustments = new Map(adjustmentRows.map((a) => [`${a.employeeId}|${toDateOnlyString(a.workDate)}`, a]));

  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const emp of employees) {
    const s = emp.shift ?? defaultShift;
    const shift: DayAwareShift = s ? { ...s, overrides: s.dayOverrides } : FALLBACK_SHIFT;
    const byDate = new Map<string, Date[]>();
    const dayShift = (date: string): DayAwareShift | undefined => {
      const chosen = adjustments.get(`${emp.id}|${date}`)?.shift;
      return chosen ? { ...chosen, overrides: chosen.dayOverrides } : undefined;
    };
    // Remote (work from home): flexible hours — no shift timing, a 9-hour minimum from `flexibleFrom`.
    const flexible = emp.workMode === "REMOTE";
    const flexibleFrom = emp.flexibleFrom ? toDateOnlyString(emp.flexibleFrom) : null;
    const enforceMinimum = (date: string) => !!flexibleFrom && date >= flexibleFrom;
    const own = punches.filter((p) => p.employeeId === emp.id).map((p) => p.punchedAt);
    if (flexible) {
      for (const [wd, list] of groupFlexiblePunches(own)) byDate.set(wd, list);
    } else {
      for (const p of own) {
        const wd = workDateOf(p, shift, dayShift);
        (byDate.get(wd) ?? byDate.set(wd, []).get(wd)!).push(p);
      }
    }

    // Days before joining, or before attendance was tracked in this system, have no record.
    const joining = trackedFrom(toDateOnlyString(emp.joiningDate), start);
    const exit = emp.exitDate ? toDateOnlyString(emp.exitDate) : null;
    for (let date = opts.from; date <= to; date = addDaysIso(date, 1)) {
      const workDate = new Date(`${date}T00:00:00Z`);
      const key = { employeeId_workDate: { employeeId: emp.id, workDate } };
      if (date < joining || (exit && date > exit)) {
        writes.push(db.attendanceDay.deleteMany({ where: { employeeId: emp.id, workDate } }));
        continue;
      }
      const isOffDay = weekendDays.includes(workDate.getUTCDay()) || holidays.has(date);
      const adj = adjustments.get(`${emp.id}|${date}`);
      const machine = byDate.get(date) ?? [];
      const effective = adj ? applyAdjustment(machine, adj) : machine;
      // An edit may judge this one day against another shift (its timing, day overrides and grace).
      const rule = ruleForDate(dayShift(date) ?? shift, date);
      // Today stays "in progress" until a check-out exists — also when only the check-in was edited.
      // A flexible day stays in progress until FLEXIBLE_DAY_SPAN_MIN after its sign-in (a sign-out may still come).
      const inProgress = !adj?.checkOut && (date === today || (flexible && !!effective[0] && Date.now() - effective[0].getTime() < FLEXIBLE_DAY_SPAN_MIN * 60_000));
      let result = flexible
        ? computeFlexibleDay(effective, enforceMinimum(date) && !isOffDay, inProgress)
        : computeDay(date, effective, rule, isOffDay, inProgress);
      // Remote before flexible hours start: a working day is a full credited day, punches or not (punches stay stored).
      if (flexible && !isOffDay && !enforceMinimum(date) && date <= today) result = null;
      // Company-sanctioned change (work from home, load-shedding early off): only the edited times are excused.
      // A correction (OTHER) never excuses: only work from home / load shedding do, whatever older rows stored.
      if (!flexible && result && adj?.excused && adj.category !== "OTHER" && !isOffDay) result = excuseAdjusted(result, adj, rule);
      if (!flexible && result && !isOffDay) result = applyLateWaiver(result, waived.has(`${emp.id}|${date}`));
      // Only an adjusted check-out (no sign-in at all): record it as the check-out, not the check-in.
      const onlyCheckOut = !!(result && adj?.checkOut && !adj.checkIn && effective.length === 1);

      let data: Omit<Prisma.AttendanceDayUncheckedCreateInput, "employeeId" | "workDate"> | null = null;
      if (result) {
        data = {
          ...result, ...(onlyCheckOut ? { firstIn: null, lastOut: adj!.checkOut } : {}), status: result.status as AttendanceStatus, isOffDay, isAdjusted: !!adj,
          shiftId: adj?.shift?.id ?? emp.shift?.id ?? defaultShift?.id ?? null, computedAt: new Date(),
        };
      } else if (!isOffDay && onLeave(emp.id, date)) {
        data = {
          status: "LEAVE", firstIn: null, lastOut: null, punchCount: 0, workedMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0,
          isOffDay, isAdjusted: false, shiftId: emp.shift?.id ?? defaultShift?.id ?? null, computedAt: new Date(),
        };
      } else if (flexible && !isOffDay && date <= today && !enforceMinimum(date)) {
        // Remote, before flexible hours started (today included): the working day is credited (no sign-ins were required).
        data = {
          status: "PRESENT", firstIn: null, lastOut: null, punchCount: 0, workedMinutes: null, lateMinutes: 0, earlyLeaveMinutes: 0,
          isOffDay, isAdjusted: false, shiftId: emp.shift?.id ?? defaultShift?.id ?? null, computedAt: new Date(),
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
