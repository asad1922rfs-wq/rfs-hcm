"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import { cancelLateWaiver, decideLateWaiver, requestLateWaiver } from "@/server/services/attendance-requests";
import { MAX_WAIVER_NOTE, WAIVER_REASON_KEYS } from "@/core/attendance/waiver";
import type { ActionResult } from "@/server/errors";

function refresh() {
  revalidatePath("/attendance/requests");
  revalidatePath("/attendance");
  revalidatePath("/dashboard");
}

const requestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  reasonKey: z.enum(WAIVER_REASON_KEYS, { message: "Choose a reason." }),
  note: z.string().trim().max(MAX_WAIVER_NOTE, `Keep the note under ${MAX_WAIVER_NOTE} characters.`).optional(),
});

export async function requestLateWaiverAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const { left } = await requestLateWaiver(await requireActor(), requestSchema.parse(formObject(fd)));
    refresh();
    return { ok: true, message: `Request sent — your manager or HR will review it. ${left} left for that month.` };
  });
}

export async function decideLateWaiverAction(id: string, approve: boolean, note: string): Promise<ActionResult> {
  return runAction(async () => {
    await decideLateWaiver(await requireActor(), id, approve, z.string().max(1000).parse(note));
    refresh();
    return { ok: true, message: approve ? "Approved — the day now counts as present." : "Request rejected." };
  });
}

export async function cancelLateWaiverAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelLateWaiver(await requireActor(), id);
    refresh();
    return { ok: true, message: "Request cancelled." };
  });
}
