import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { recomputeAttendance } from "@/server/services/attendance";
import { isPayrollLockedFor } from "@/server/services/payroll-lock";
import { parseDateOnly, todayInPKT, toDateOnlyString } from "@/lib/dates";

// Public holidays are company-wide off days, handled exactly like the weekend: nobody is absent or deducted.

const d0 = (s: string) => new Date(`${s}T00:00:00Z`);

/** Fixed-date national holidays of Pakistan. Eid, Muharram and Milad follow the moon and are added by hand. */
export const PAKISTAN_FIXED_HOLIDAYS: readonly { monthDay: string; name: string }[] = [
  { monthDay: "02-05", name: "Kashmir Day" },
  { monthDay: "03-23", name: "Pakistan Day" },
  { monthDay: "05-01", name: "Labour Day" },
  { monthDay: "05-28", name: "Youm-e-Takbeer" },
  { monthDay: "08-14", name: "Independence Day" },
  { monthDay: "11-09", name: "Iqbal Day" },
  { monthDay: "12-25", name: "Quaid-e-Azam Day" },
];

/** Holidays in [from, to] as date → name. */
export async function holidaysBetween(from: string, to: string): Promise<Map<string, string>> {
  const rows = await db.holiday.findMany({ where: { date: { gte: d0(from), lte: d0(to) } }, select: { date: true, name: true } });
  return new Map(rows.map((h) => [toDateOnlyString(h.date), h.name]));
}

/** Holiday dates ("YYYY-MM-DD") in [from, to]. */
export async function holidayDatesBetween(from: string, to: string): Promise<Set<string>> {
  return new Set((await holidaysBetween(from, to)).keys());
}

export function listHolidays(year: number) {
  return db.holiday.findMany({ where: { date: { gte: d0(`${year}-01-01`), lte: d0(`${year}-12-31`) } }, orderBy: { date: "asc" } });
}

async function assertUnlocked(date: string) {
  if (await isPayrollLockedFor(date)) throw new AppError(`Payroll for ${date.slice(0, 7)} is already approved — holidays in that month can no longer change.`);
}

/** Re-evaluate the day so it turns OFF (or back into a working day) straight away. Future days need nothing. */
async function refreshDay(date: string) {
  if (date <= toDateOnlyString(todayInPKT())) await recomputeAttendance({ from: date, to: date });
}

/** Add a holiday, or rename the one already on that date. */
export async function saveHoliday(actor: Actor, input: { date: string; name: string }) {
  assertPermission(actor, "settings.organisation", "all");
  const date = toDateOnlyString(parseDateOnly(input.date));
  const name = input.name.trim();
  if (!name) throw new AppError("Give the holiday a name.");
  await assertUnlocked(date);
  try {
    const before = await db.holiday.findUnique({ where: { date: d0(date) } });
    const after = before
      ? await db.holiday.update({ where: { id: before.id }, data: { name } })
      : await db.holiday.create({ data: { date: d0(date), name } });
    await recordAudit({ actor, action: before ? "holiday.update" : "holiday.create", entityType: "Holiday", entityId: after.id, before, after });
    if (!before) await refreshDay(date);
    return after;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError("There is already a holiday on that date.");
    throw err;
  }
}

export async function deleteHoliday(actor: Actor, id: string) {
  assertPermission(actor, "settings.organisation", "all");
  const before = await db.holiday.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("Holiday not found.");
  const date = toDateOnlyString(before.date);
  await assertUnlocked(date);
  await db.holiday.delete({ where: { id } });
  await recordAudit({ actor, action: "holiday.delete", entityType: "Holiday", entityId: id, before });
  await refreshDay(date);
  return before;
}

/** Insert the fixed-date national holidays for a year where missing. Dates in an approved payroll month are skipped. */
export async function loadPakistanHolidays(actor: Actor, year: number) {
  assertPermission(actor, "settings.organisation", "all");
  const existing = await holidayDatesBetween(`${year}-01-01`, `${year}-12-31`);
  let added = 0, skipped = 0;
  for (const h of PAKISTAN_FIXED_HOLIDAYS) {
    const date = `${year}-${h.monthDay}`;
    if (existing.has(date)) continue;
    if (await isPayrollLockedFor(date)) {
      skipped++;
      continue;
    }
    const after = await db.holiday.create({ data: { date: d0(date), name: h.name } });
    await recordAudit({ actor, action: "holiday.create", entityType: "Holiday", entityId: after.id, after });
    await refreshDay(date);
    added++;
  }
  return { added, skipped };
}
