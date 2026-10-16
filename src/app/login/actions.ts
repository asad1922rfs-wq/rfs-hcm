"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { attemptLogin } from "@/server/auth/login";
import { destroyCurrentSession, getActor, requestMeta } from "@/server/auth/session";
import { recordAudit } from "@/server/audit";
import type { ActionResult } from "@/server/errors";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your email or Employee ID.").max(120),
  password: z.string().min(1, "Enter your password.").max(128),
  next: z.string().optional(),
});

/** Only allow same-site relative redirects after sign-in. */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function loginAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const { ip } = await requestMeta();
  const result = await attemptLogin(parsed.data.identifier, parsed.data.password, ip);
  if (!result.ok) return { ok: false, error: result.error };
  redirect(result.mustChangePassword ? "/change-password" : safeNext(parsed.data.next));
}

export async function signOutAction(): Promise<void> {
  const actor = await getActor();
  if (actor) await recordAudit({ actor, action: "auth.logout", entityType: "User", entityId: actor.userId });
  await destroyCurrentSession();
  redirect("/login");
}
