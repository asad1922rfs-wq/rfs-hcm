"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import {
  addPayrollAdjustment, approveRun, markRunPaid, prepareRun, recalculateRun, rejectRun, removePayrollAdjustment, submitRun,
} from "@/server/services/payroll";
import { money, requiredText } from "@/lib/validation";
import type { ActionResult } from "@/server/errors";

export async function prepareRunAction(_prev: ActionResult<{ id: string }> | null, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const result = await runAction<{ id: string }>(async () => {
    const { period } = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.") }).parse(formObject(fd));
    const run = await prepareRun(await requireActor(), Number(period.slice(0, 4)), Number(period.slice(5, 7)));
    return { ok: true, data: { id: run.id } };
  });
  if (result.ok && result.data) {
    revalidatePath("/payroll");
    redirect(`/payroll/${result.data.id}`);
  }
  return result;
}

function workflow(fn: (actor: Awaited<ReturnType<typeof requireActor>>) => Promise<unknown>, runId: string, message: string): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    await fn(await requireActor());
    revalidatePath(`/payroll/${runId}`);
    revalidatePath("/payroll");
    revalidatePath("/dashboard");
    return { ok: true as const, message };
  });
}

export async function recalculateAction(runId: string): Promise<ActionResult> {
  return workflow((a) => recalculateRun(a, runId), runId, "Payroll recalculated from current attendance and salaries.");
}
export async function submitAction(runId: string): Promise<ActionResult> {
  return workflow((a) => submitRun(a, runId), runId, "Submitted to Finance for approval.");
}
export async function approveAction(runId: string): Promise<ActionResult> {
  return workflow((a) => approveRun(a, runId), runId, "Payroll approved and locked.");
}
export async function markPaidAction(runId: string): Promise<ActionResult> {
  return workflow((a) => markRunPaid(a, runId), runId, "Marked as paid.");
}
export async function rejectAction(runId: string, note: string): Promise<ActionResult> {
  return workflow((a) => rejectRun(a, runId, z.string().max(500).parse(note)), runId, "Sent back to HR.");
}

const adjustmentSchema = z.object({
  kind: z.enum(["EARNING", "DEDUCTION"]),
  label: requiredText("Description", 100),
  amount: money("Amount").refine((n) => n > 0, "Amount must be more than 0."),
});

export async function addAdjustmentAction(runId: string, itemId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = adjustmentSchema.parse(formObject(fd));
    await addPayrollAdjustment(await requireActor(), itemId, input);
    revalidatePath(`/payroll/${runId}`);
    return { ok: true, message: "Adjustment added." };
  });
}

export async function removeAdjustmentAction(runId: string, adjustmentId: string): Promise<ActionResult> {
  return runAction(async () => {
    await removePayrollAdjustment(await requireActor(), adjustmentId);
    revalidatePath(`/payroll/${runId}`);
    return { ok: true, message: "Adjustment removed." };
  });
}
