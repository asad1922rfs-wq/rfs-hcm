import type { NextRequest } from "next/server";
import { DEVICE_CLOCK_OFFSET_MINUTES, handleAdms } from "@/server/services/adms-direct";

export const dynamic = "force-dynamic";
const MAX_BODY = 4 * 1024 * 1024;

/** ZKTeco ADMS push straight from the attendance machine (Comm → Cloud Server = rfstech.online). */
async function handle(req: NextRequest) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  let reply = { status: 200, text: "OK" };
  try {
    const body = req.method === "POST" ? await req.text() : "";
    reply = body.length > MAX_BODY ? { status: 413, text: "Too large" } : await handleAdms(req.method, path, url.searchParams, body);
  } catch (err) {
    console.error("ADMS error", err);
    reply = { status: 500, text: "ERROR" };
  }
  // The machine sets its clock from this header.
  const deviceNow = new Date(Date.now() + DEVICE_CLOCK_OFFSET_MINUTES * 60_000);
  return new Response(reply.text, {
    status: reply.status,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", Date: deviceNow.toUTCString() },
  });
}

export const GET = handle;
export const POST = handle;
