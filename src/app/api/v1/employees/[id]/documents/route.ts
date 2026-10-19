import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { uploadDocument } from "@/server/services/documents";
import { DOCUMENT_CATEGORIES, MAX_DOCUMENT_BYTES } from "@/core/documents/meta";
import { parseDateOnly } from "@/lib/dates";

export const dynamic = "force-dynamic";

// A route handler rather than a server action: server actions are capped at 4 MB (next.config.ts), documents at 10 MB.

const metaSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES, { error: "Choose a category." }),
  title: z.string().trim().min(1, "Enter a title.").max(200, "Keep the title under 200 characters."),
  expiresOn: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      try {
        return parseDateOnly(v);
      } catch {
        ctx.addIssue({ code: "custom", message: "Enter a valid expiry date." });
        return z.NEVER;
      }
    }),
});

/** Same-origin check for this cookie-authenticated POST (server actions get the equivalent check from Next.js). */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // SameSite=Lax already keeps the session cookie off cross-site POSTs
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Upload one document (multipart: file, category, title, expiresOn). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_DOCUMENT_BYTES + 64 * 1024) return NextResponse.json({ error: "The file must be 10 MB or smaller." }, { status: 413 });

  const { id } = await params;
  try {
    let fd: FormData;
    try {
      fd = await req.formData();
    } catch {
      throw new AppError("The upload could not be read. Try again.");
    }
    const file = fd.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a file to upload.");
    const parsed = metaSchema.safeParse({
      category: fd.get("category") ?? undefined,
      title: fd.get("title") ?? undefined,
      expiresOn: fd.get("expiresOn") ?? undefined,
    });
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
    const doc = await uploadDocument(actor, id, file, parsed.data);
    revalidatePath(`/employees/${id}`);
    revalidatePath("/me");
    return NextResponse.json({ id: doc.id }, { status: 201 });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Document upload failed", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
