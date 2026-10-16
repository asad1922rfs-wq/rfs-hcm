import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { ForbiddenError } from "@/server/errors";
import { buildSalaryTemplate } from "@/server/services/salary-import";

export const dynamic = "force-dynamic";

/** Download the salary upload template (signed-in users with salary.manage only). */
export async function GET() {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const file = await buildSalaryTemplate(actor);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="rfs-hcm-salaries.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw err;
  }
}
