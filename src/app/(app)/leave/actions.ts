"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import { cancelLeave, decideLeave, requestLeave, saveLeaveType } from "@/server/services/leave";
import { optionalId, requiredText } from "@/lib/validation";
import type { ActionResult } from "@/server/errors";

function refresh() {
  revalidatePath("/leave");
  revalidatePath("/dashboard");
  revalidatePath("/attendance");
}

const requestSchema = z.object({
  employeeId: optionalId,
  leaveTypeId: requiredText("Leave type", 40),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date."),
  reason: z.string().trim().min(3, "Give a reason.").max(500),
});

export async function requestLeaveAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const r = await requestLeave(actor, requestSchema.parse(formObject(fd)));
    refresh();
    return { ok: true, message: r.status === "APPROVED" ? `Leave recorded (${r.days} day${r.days === 1 ? "" : "s"}).` : `Leave requested (${r.days} working day${r.days === 1 ? "" : "s"}). Your manager or HR will review it.` };
  });
}

export async function decideLeaveAction(id: string, approve: boolean, note: string): Promise<ActionResult> {
  return runAction(async () => {
    await decideLeave(await requireActor(), id, approve, z.string().max(300).parse(note));
    refresh();
    return { ok: true, message: approve ? "Leave approved." : "Leave rejected." };
  });
}

export async function cancelLeaveAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelLeave(await requireActor(), id);
    refresh();
    return { ok: true, message: "Leave cancelled." };
  });
}

export async function saveLeaveTypeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z
      .object({
        id: optionalId,
        name: requiredText("Name", 60),
        code: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().max(12).optional()),
        daysPerYear: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(0).max(366).nullable()),
        isPaid: z.boolean(),
        isActive: z.boolean(),
      })
      .parse({ ...formObject(fd), isPaid: fd.get("isPaid") === "on", isActive: fd.get("isActive") === "on" });
    await saveLeaveType(actor, input);
    revalidatePath("/settings/leave-types");
    refresh();
    return { ok: true, message: "Leave type saved." };
  });
}
