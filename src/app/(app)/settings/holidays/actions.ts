"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import { deleteHoliday, loadPakistanHolidays, saveHoliday } from "@/server/services/holidays";
import { dateOnly, requiredText } from "@/lib/validation";
import { toDateOnlyString } from "@/lib/dates";
import type { ActionResult } from "@/server/errors";

// A holiday changes attendance, leave and pay, so every page that shows them is refreshed.
function revalidateAll() {
  revalidatePath("/settings/holidays");
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

export async function saveHolidayAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z.object({ date: dateOnly("Date"), name: requiredText("Name", 120) }).parse(formObject(fd));
    await saveHoliday(actor, { date: toDateOnlyString(input.date), name: input.name });
    revalidateAll();
    return { ok: true, message: "Holiday saved. Attendance for that day has been recalculated." };
  });
}

export async function deleteHolidayAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteHoliday(await requireActor(), id);
    revalidateAll();
    return { ok: true, message: "Holiday removed. That day is a working day again." };
  });
}

export async function loadPakistanHolidaysAction(year: number): Promise<ActionResult> {
  return runAction(async () => {
    const y = z.number().int().min(2000).max(2100).parse(year);
    const { added, skipped } = await loadPakistanHolidays(await requireActor(), y);
    revalidateAll();
    const message = added === 0 ? `All fixed-date holidays for ${y} are already in the list.` : `Added ${added} holiday${added === 1 ? "" : "s"} for ${y}.`;
    return { ok: true, message: skipped ? `${message} ${skipped} skipped because that month's payroll is approved.` : message };
  });
}
