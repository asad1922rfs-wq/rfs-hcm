import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor, type Actor } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import type { ReportFile } from "@/server/services/reports";

// Shared plumbing for the report downloads: session check, query validation, error mapping, .xlsx response.
// Scope always comes from the session; query parameters can only narrow what the actor may already see.

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const optionalId = z.preprocess(blank, z.string().trim().max(40).optional());

/** "2026-10" → { year: 2026, month: 10 } */
export const monthParam = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM.")
  .transform((v) => ({ year: Number(v.slice(0, 4)), month: Number(v.slice(5, 7)) }));

export const dateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be YYYY-MM-DD.")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, "Invalid date.");

export const yearParam = z.coerce.number().int().min(2000).max(2100);

export async function xlsxReport<S extends z.ZodType>(
  req: Request,
  schema: S,
  build: (actor: Actor, input: z.infer<S>) => Promise<ReportFile>,
): Promise<NextResponse> {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_request" }, { status: 400 });
  try {
    const { buffer, filename } = await build(actor, parsed.data);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
