import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { expectedPayslipPdf } from "@/server/services/payslips";

export const dynamic = "force-dynamic";

/**
 * Expected payslip PDF for ?employee=<id> (default: your own) and ?period=current|previous (default: current).
 * Serves the real payslip once that month's payroll is approved. ?download=1 saves it, otherwise it opens inline.
 */
export async function GET(req: Request) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(req.url).searchParams;
  try {
    const { pdf, filename } = await expectedPayslipPdf(actor, {
      employeeId: params.get("employee"),
      period: params.get("period") === "previous" ? "previous" : "current",
    });
    const disposition = params.get("download") ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="${filename}"`, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
