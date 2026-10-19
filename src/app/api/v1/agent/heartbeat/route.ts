import { after, NextResponse, type NextRequest } from "next/server";
import { agentHeartbeat, authenticateAgent, heartbeatSchema } from "@/server/services/devices";
import { recomputeAttendance } from "@/server/services/attendance";
import { addDaysIso } from "@/core/attendance/engine";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * Keep attendance fresh without waiting for a punch (e.g. after a manual fix, an interrupted sync or a rule change):
 * every 10 minutes for today and yesterday, and once after each start for last month onwards.
 */
const REFRESH_EVERY_MS = 10 * 60_000;
let lastRefresh = 0;

function refreshRecentAttendance() {
  if (Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
  const firstSinceStart = lastRefresh === 0;
  lastRefresh = Date.now();
  const today = toDateOnlyString(todayInPKT());
  // After a deploy or restart, recalculate from the start of last month so changed rules apply to open months too.
  const from = firstSinceStart ? `${addMonthsIso(today.slice(0, 7), -1)}-01` : addDaysIso(today, -1);
  after(() => recomputeAttendance({ from, to: today }).catch((err) => console.error("attendance refresh failed", err)));
}

/** "YYYY-MM" shifted by n months. */
function addMonthsIso(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Sync agent → server every minute: agent/device health and command results. Returns pending commands. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 256 * 1024) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const agent = await authenticateAgent(req.headers, raw);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = heartbeatSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const result = await agentHeartbeat(agent, ip, parsed.data);
    refreshRecentAttendance();
    return NextResponse.json(result);
  } catch (err) {
    console.error("agent heartbeat failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
