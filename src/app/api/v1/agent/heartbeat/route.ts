import { NextResponse, type NextRequest } from "next/server";
import { agentHeartbeat, authenticateAgent, heartbeatSchema } from "@/server/services/devices";

export const dynamic = "force-dynamic";

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
    return NextResponse.json(await agentHeartbeat(agent, ip, parsed.data));
  } catch (err) {
    console.error("agent heartbeat failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
