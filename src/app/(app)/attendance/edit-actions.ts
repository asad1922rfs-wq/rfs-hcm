"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import { removeAttendanceAdjustment, saveAttendanceAdjustment } from "@/server/services/attendance-edit";
import type { ActionResult } from "@/server/errors";

const time = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM").nullable());

export async function saveAdjustmentAction(employeeId: string, date: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z
      .object({ checkIn: time, checkOut: time, reason: z.string().trim().min(3, "Give a reason for the change.").max(300) })
      .parse(formObject(fd));
    await saveAttendanceAdjustment(actor, { employeeId, date, ...input });
    revalidatePath("/attendance");
    revalidatePath(`/employees/${employeeId}`);
    revalidatePath("/dashboard");
    return { ok: true, message: "Attendance updated." };
  });
}

export async function removeAdjustmentAction(employeeId: string, date: string): Promise<ActionResult> {
  return runAction(async () => {
    await removeAttendanceAdjustment(await requireActor(), employeeId, date);
    revalidatePath("/attendance");
    revalidatePath(`/employees/${employeeId}`);
    revalidatePath("/dashboard");
    return { ok: true, message: "Manual change removed — machine times restored." };
  });
}
