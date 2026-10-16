"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import {
  ADJUSTMENT_CATEGORIES, bulkSaveAttendanceAdjustments, removeAttendanceAdjustment, saveAttendanceAdjustment,
} from "@/server/services/attendance-edit";
import type { ActionResult } from "@/server/errors";

const time = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").nullable());

const adjustmentSchema = z.object({
  checkIn: time,
  checkOut: time,
  reason: z.string().trim().min(3, "Give a reason for the change.").max(300),
  category: z.enum(ADJUSTMENT_CATEGORIES).default("OTHER"),
  excused: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

function parse(fd: FormData) {
  return adjustmentSchema.parse({ ...formObject(fd), excused: fd.get("excused") });
}

function refresh(employeeIds: string[]) {
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
  for (const id of employeeIds.slice(0, 50)) revalidatePath(`/employees/${id}`);
}

export async function saveAdjustmentAction(employeeId: string, date: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await saveAttendanceAdjustment(await requireActor(), { employeeId, date, ...parse(fd) });
    refresh([employeeId]);
    return { ok: true, message: "Attendance updated." };
  });
}

export async function bulkAdjustmentAction(
  employeeIds: string[],
  date: string,
  _prev: ActionResult<{ updated: number; skipped: { name: string; reason: string }[] }> | null,
  fd: FormData,
): Promise<ActionResult<{ updated: number; skipped: { name: string; reason: string }[] }>> {
  return runAction(async () => {
    const ids = z.array(z.string().min(1).max(40)).max(500).parse(employeeIds);
    const result = await bulkSaveAttendanceAdjustments(await requireActor(), { employeeIds: ids, date, ...parse(fd) });
    refresh(ids);
    return { ok: true, data: result, message: `Updated ${result.updated} employee${result.updated === 1 ? "" : "s"}.` };
  });
}

export async function removeAdjustmentAction(employeeId: string, date: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeAttendanceAdjustment(await requireActor(), employeeId, date);
    refresh([employeeId]);
    return { ok: true, message: "Manual change removed — machine times restored." };
  });
}
