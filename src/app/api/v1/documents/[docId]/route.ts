import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { readDocument } from "@/server/services/documents";

export const dynamic = "force-dynamic";

/** One employee document. PDFs and images open in the browser; Word files download. ?download=1 always downloads. */
export async function GET(req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const doc = await readDocument(actor, (await params).docId);
    const download = !!new URL(req.url).searchParams.get("download");
    const disposition = download ? doc.disposition.replace(/^inline/, "attachment") : doc.disposition;
    return new NextResponse(new Uint8Array(doc.data), {
      headers: {
        "Content-Type": doc.mime,
        "Content-Length": String(doc.data.length),
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Uploaded files are shown as passive content only. Images get the logo route's sandbox; Chromium's built-in
        // PDF viewer refuses to run in a sandboxed document, so PDFs get the same policy without the sandbox flag.
        "Content-Security-Policy": doc.mime === "application/pdf"
          ? "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; object-src 'self'; frame-ancestors 'none'"
          : "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; sandbox",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
