// Forwards stored punches to RFS HCM and reports health. All requests are HMAC-signed; see
// src/server/services/devices.ts (authenticateAgent) on the server side.

import { createHmac } from "node:crypto";
import { AGENT_VERSION, type AgentConfig } from "./config.ts";
import type { Outbox } from "./outbox.ts";

const BATCH = 500;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

async function post(cfg: AgentConfig, path: string, payload: unknown): Promise<unknown> {
  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const sig = createHmac("sha256", cfg.agentSecret).update(`${ts}.${body}`).digest("hex");
  const res = await fetch(`${cfg.serverUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-rfs-agent": cfg.agentId, "x-rfs-timestamp": ts, "x-rfs-signature": sig },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

export function startUplink(cfg: AgentConfig, outbox: Outbox, log: (msg: string) => void) {
  let backoff = 5_000;
  let lastError = "";

  const forward = async () => {
    try {
      let batch = outbox.pending(BATCH);
      while (batch.length > 0) {
        const result = (await post(cfg, "/api/v1/agent/punches", {
          punches: batch.map(({ serial, pin, local, state, verify }) => ({ serial, pin, local, state, verify })),
        })) as { inserted: number };
        outbox.markSent(batch.map((p) => p.id));
        log(`Forwarded ${batch.length} punch(es) to server (${result.inserted} new)`);
        batch = outbox.pending(BATCH);
      }
      if (lastError) log("Server connection restored");
      lastError = "";
      backoff = 5_000;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastError) log(`Forwarding failed (${msg}); ${outbox.pendingCount()} punch(es) kept locally, retrying`);
      lastError = msg;
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
    setTimeout(forward, backoff);
  };

  const heartbeat = async () => {
    try {
      const results = outbox.unreportedResults();
      const response = (await post(cfg, "/api/v1/agent/heartbeat", {
        version: AGENT_VERSION,
        outbox: outbox.pendingCount(),
        devices: outbox.devices(),
        results,
      })) as { commands: { id: string; serial: string; type: string; payload: Record<string, unknown> }[] };
      outbox.markReported(results.map((r) => r.id));
      for (const c of response.commands) {
        outbox.queueCommand(c);
        log(`Queued ${c.type} for device ${c.serial}`);
      }
    } catch (err) {
      log(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(heartbeat, 60_000);
  };

  void forward();
  void heartbeat();
}
