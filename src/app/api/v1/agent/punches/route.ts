import { NextResponse, type NextRequest } from "next/server";
import { authenticateAgent, punchBatchSchema, receiveAgentPunches } from "@/server/services/devices";

export const dynamic = "force-dynamic";
const MAX_BODY = 2 * 1024 * 1024;

/** Sync agent → server: a batch of raw device punches. Idempotent: re-sent punches are skipped. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  const agent = await authenticateAgent(req.headers, raw);
  if (!agent) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = punchBatchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  try {
    return NextResponse.json(await receiveAgentPunches(agent, parsed.data));
  } catch (err) {
    console.error("agent punches failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
