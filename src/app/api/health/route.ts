import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for Docker and uptime monitoring. Reveals nothing beyond up/down. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "db_unavailable" }, { status: 503 });
  }
}
