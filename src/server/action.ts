import "server-only";
import { z } from "zod";
import { AppError, type ActionResult } from "@/server/errors";
import { fieldErrors } from "@/lib/validation";

/**
 * Wraps a server action body: converts validation and domain errors into an ActionResult the form can show,
 * and hides unexpected errors from the user (they are logged on the server instead).
 */
export async function runAction<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    // Next.js uses thrown errors for redirect()/notFound(); let those propagate.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    if (err instanceof z.ZodError) return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: fieldErrors(err) };
    if (err instanceof AppError) return { ok: false, error: err.message };
    console.error("Unhandled action error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && !k.includes(".")) out[k] = v;
  return out;
}
