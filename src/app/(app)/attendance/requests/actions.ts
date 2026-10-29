"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import { bulkDecideLateWaivers, cancelLateWaiver, decideLateWaiver, requestLateWaiver, type BulkDecideResult } from "@/server/services/attendance-requests";
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

const bulkSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1, "Select at least one request.").max(200, "Select at most 200 requests at a time."),
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(1000),
}).refine((v) => v.decision === "APPROVE" || v.note.length >= 3, { message: "Give a reason for rejecting — the employees will see it.", path: ["note"] });

export async function bulkDecideAction(ids: string[], decision: "APPROVE" | "REJECT", note = ""): Promise<ActionResult<BulkDecideResult>> {
  return runAction(async () => {
    const v = bulkSchema.parse({ ids, decision, note });
    const data = await bulkDecideLateWaivers(await requireActor(), v.ids, v.decision === "APPROVE", v.note);
    refresh();
    return { ok: true, data, message: `${v.decision === "APPROVE" ? "Approved" : "Rejected"} ${data.decided}` };
  });
}

export async function cancelLateWaiverAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelLateWaiver(await requireActor(), id);
    refresh();
    return { ok: true, message: "Request cancelled." };
  });
}
