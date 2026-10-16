"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { passwordSchema } from "@/server/auth/password";
import { changeOwnPassword } from "@/server/services/users";
import { runAction } from "@/server/action";
import type { ActionResult } from "@/server/errors";

const schema = z
  .object({ currentPassword: z.string().min(1, "Enter your current password."), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "Passwords do not match." });

export async function changePasswordAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await requireActor({ allowPendingPasswordChange: true });
    const input = schema.parse(Object.fromEntries(fd));
    await changeOwnPassword(actor, input.currentPassword, input.newPassword);
    return { ok: true };
  });
  if (result.ok) redirect("/dashboard");
  return result;
}
