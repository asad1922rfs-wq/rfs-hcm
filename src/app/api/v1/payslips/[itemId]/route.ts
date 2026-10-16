import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { payslipPdf } from "@/server/services/payslips";

export const dynamic = "force-dynamic";

/** Single payslip PDF. ?download=1 saves it, otherwise it opens in the browser (for printing). */
export async function GET(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { pdf, filename } = await payslipPdf(actor, (await params).itemId);
    const disposition = new URL(req.url).searchParams.get("download") ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
