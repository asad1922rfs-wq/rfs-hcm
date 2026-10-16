"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/action";
import { createAgent, requestResync, setAgentActive, updateDevice } from "@/server/services/devices";
import { requiredText } from "@/lib/validation";
import type { ActionResult } from "@/server/errors";

export async function createAgentAction(_prev: ActionResult<{ id: string; secret: string }> | null, fd: FormData) {
  return runAction<{ id: string; secret: string }>(async () => {
    const actor = await requireActor();
    const { name } = z.object({ name: requiredText("Name", 80) }).parse({ name: fd.get("name") });
    const created = await createAgent(actor, name);
    revalidatePath("/settings/devices");
    return { ok: true, data: created };
  });
}

export async function setAgentActiveAction(agentId: string, isActive: boolean): Promise<ActionResult> {
  return runAction(async () => {
    await setAgentActive(await requireActor(), agentId, isActive);
    revalidatePath("/settings/devices");
    return { ok: true, message: isActive ? "Agent enabled." : "Agent revoked. It can no longer send data." };
  });
}

export async function resyncAction(deviceId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requestResync(await requireActor(), deviceId);
    revalidatePath("/settings/devices");
    return { ok: true, message: "Sync requested. The device will re-send the last 35 days within about a minute." };
  });
}

export async function updateDeviceAction(deviceId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = z
      .object({ name: z.string().trim().max(80).optional(), isActive: z.boolean() })
      .parse({ name: (fd.get("name") as string) || undefined, isActive: fd.get("isActive") === "on" });
    await updateDevice(await requireActor(), deviceId, input);
    revalidatePath("/settings/devices");
    return { ok: true, message: "Device saved." };
  });
}
