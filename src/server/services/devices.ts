import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { decryptField, encryptField, randomToken } from "@/server/crypto";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { ingestPunches } from "@/server/services/attendance";
import { punchFromDeviceRecord, type ParsedPunch } from "@/core/attendance/punch-parser";
import { addDaysIso } from "@/core/attendance/engine";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

/** An agent or device not heard from for this long is shown as offline. */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// ───────────── Agent request authentication ─────────────
// Each request carries x-rfs-agent (agent id), x-rfs-timestamp (ms) and
// x-rfs-signature = hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`).

export function signAgentRequest(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function authenticateAgent(headers: Headers, rawBody: string) {
  const agentId = headers.get("x-rfs-agent") ?? "";
  const timestamp = headers.get("x-rfs-timestamp") ?? "";
  const signature = headers.get("x-rfs-signature") ?? "";
  if (!agentId || !/^\d{13}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return null;
  if (Math.abs(Date.now() - Number(timestamp)) > MAX_CLOCK_SKEW_MS) return null;

  const agent = await db.syncAgent.findUnique({ where: { id: agentId } });
  if (!agent || !agent.isActive) return null;
  const expected = Buffer.from(signAgentRequest(decryptField(agent.secretEnc), timestamp, rawBody), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given) ? agent : null;
}

// ───────────── Agent API payloads ─────────────

const deviceRecord = z.object({
  serial: z.string().min(1).max(40),
  pin: z.string().min(1).max(20),
  local: z.string().max(25),
  state: z.string().max(10).nullish(),
  verify: z.string().max(10).nullish(),
});

export const punchBatchSchema = z.object({ punches: z.array(deviceRecord).max(5000) });

export const heartbeatSchema = z.object({
  version: z.string().max(40),
  outbox: z.number().int().min(0),
  devices: z
    .array(
      z.object({
        serial: z.string().min(1).max(40),
        lastSeenAt: z.string().datetime(),
        pushVersion: z.string().max(20).nullish(),
        info: z.record(z.string(), z.string().max(200)).nullish(),
      }),
    )
    .max(50),
  results: z.array(z.object({ id: z.string().max(40), ok: z.boolean(), message: z.string().max(500) })).max(100).default([]),
});

async function ensureDevice(agentId: string, serial: string) {
  return db.attendanceDevice.upsert({
    where: { serialNumber: serial },
    create: { serialNumber: serial, agentId },
    update: { agentId },
  });
}

export async function receiveAgentPunches(agent: { id: string }, body: z.infer<typeof punchBatchSchema>) {
  const punches: ParsedPunch[] = [];
  let invalid = 0;
  for (const r of body.punches) {
    const p = punchFromDeviceRecord(r);
    if (p && p.punchedAt.getTime() <= Date.now() + 24 * 3_600_000) punches.push(p);
    else invalid++;
  }

  const serials = [...new Set(punches.map((p) => p.deviceSerial))];
  const devices = await Promise.all(serials.map((s) => ensureDevice(agent.id, s)));
  const blocked = new Set(devices.filter((d) => !d.isActive).map((d) => d.serialNumber));
  const accepted = punches.filter((p) => !blocked.has(p.deviceSerial));

  const { inserted } = await ingestPunches(accepted, "AGENT");
  for (const serial of serials.filter((s) => !blocked.has(s))) {
    const latest = accepted.filter((p) => p.deviceSerial === serial).reduce((m, p) => (p.punchedAt > m ? p.punchedAt : m), new Date(0));
    await db.attendanceDevice.update({
      where: { serialNumber: serial },
      data: { lastSeenAt: new Date(), lastPunchAt: latest.getTime() > 0 ? latest : undefined },
    });
  }
  // Blocked-device punches are acknowledged (so the agent does not retry forever) but not stored.
  return { received: body.punches.length, inserted, invalid, ignoredFromBlockedDevices: punches.length - accepted.length };
}

export async function agentHeartbeat(agent: { id: string }, ip: string | null, body: z.infer<typeof heartbeatSchema>) {
  await db.syncAgent.update({
    where: { id: agent.id },
    data: { lastSeenAt: new Date(), lastIp: ip, version: body.version, outboxCount: body.outbox },
  });
  for (const d of body.devices) {
    await ensureDevice(agent.id, d.serial);
    await db.attendanceDevice.update({
      where: { serialNumber: d.serial },
      data: {
        lastSeenAt: new Date(d.lastSeenAt),
        pushVersion: d.pushVersion ?? undefined,
        model: d.info?.DeviceName ?? d.info?.["~DeviceName"] ?? undefined,
        // Full options (FWVersion) arrive only at handshake; getrequest INFO starts with the firmware string.
        firmware: d.info?.FWVersion ?? d.info?.FirmVer ?? d.info?.INFO?.split(",")[0] ?? undefined,
      },
    });
  }
  for (const r of body.results) {
    await db.agentCommand.updateMany({
      where: { id: r.id, agentId: agent.id },
      data: { status: r.ok ? "DONE" : "FAILED", result: r.message, completedAt: new Date() },
    });
  }

  const pending = await db.agentCommand.findMany({ where: { agentId: agent.id, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 20 });
  if (pending.length) {
    await db.agentCommand.updateMany({ where: { id: { in: pending.map((c) => c.id) } }, data: { status: "SENT", sentAt: new Date() } });
  }
  return { commands: pending.map((c) => ({ id: c.id, serial: c.deviceSerial, type: c.type, payload: c.payload })) };
}

// ───────────── Admin ─────────────

export async function listDevicesAndAgents() {
  const [agents, devices, commands] = await Promise.all([
    db.syncAgent.findMany({ orderBy: { createdAt: "asc" } }),
    db.attendanceDevice.findMany({ orderBy: { createdAt: "asc" }, include: { agent: { select: { name: true } } } }),
    db.agentCommand.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return { agents, devices, commands };
}

export async function createAgent(actor: Actor, name: string) {
  assertPermission(actor, "device.manage", "all");
  const secret = `rfsa_${randomToken(32)}`;
  const agent = await db.syncAgent.create({ data: { name, secretEnc: encryptField(secret) } });
  await recordAudit({ actor, action: "agent.create", entityType: "SyncAgent", entityId: agent.id, after: { name } });
  return { id: agent.id, secret };
}

export async function setAgentActive(actor: Actor, agentId: string, isActive: boolean) {
  assertPermission(actor, "device.manage", "all");
  await db.syncAgent.update({ where: { id: agentId }, data: { isActive } });
  await recordAudit({ actor, action: isActive ? "agent.enable" : "agent.revoke", entityType: "SyncAgent", entityId: agentId });
}

export async function updateDevice(actor: Actor, deviceId: string, input: { name?: string; isActive: boolean }) {
  assertPermission(actor, "device.manage", "all");
  const before = await db.attendanceDevice.findUnique({ where: { id: deviceId } });
  if (!before) throw new NotFoundError("Device not found.");
  const after = await db.attendanceDevice.update({ where: { id: deviceId }, data: { name: input.name ?? null, isActive: input.isActive } });
  await recordAudit({ actor, action: "device.update", entityType: "AttendanceDevice", entityId: deviceId, before, after });
}

/** "Sync now": ask the device (through its agent) to re-send attendance for the last `days` days. */
export async function requestResync(actor: Actor, deviceId: string, days = 35) {
  assertPermission(actor, "device.manage", "all");
  const device = await db.attendanceDevice.findUnique({ where: { id: deviceId } });
  if (!device?.agentId) throw new AppError("This device has no sync agent yet.");
  const to = toDateOnlyString(todayInPKT());
  const from = addDaysIso(to, -days);
  const payload: Prisma.InputJsonValue = { from: `${from} 00:00:00`, to: `${to} 23:59:59` };
  const cmd = await db.agentCommand.create({
    data: { agentId: device.agentId, deviceSerial: device.serialNumber, type: "RESYNC_ATTLOG", payload, createdById: actor.userId },
  });
  await recordAudit({ actor, action: "device.resync", entityType: "AttendanceDevice", entityId: deviceId, after: payload });
  return cmd;
}
