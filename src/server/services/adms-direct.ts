import "server-only";
import { db } from "@/server/db";
import { ingestPunches } from "@/server/services/attendance";
import { punchFromDeviceRecord, type ParsedPunch } from "@/core/attendance/punch-parser";
import { commandLine, handshakeText, parseAttlog, parseInfo } from "@/core/attendance/adms";

// Direct ADMS: the attendance machine pushes straight to the website, no office PC.
// Only machines an admin has switched to direct push (Biometric devices → Edit) and that are active are accepted;
// any other serial number gets 403 and nothing is stored.

const TIMEZONE_HOURS = 5; // PKT
/** The machine sets its clock from our Date header: same offset the office agent used (machine 2 minutes behind). */
export const DEVICE_CLOCK_OFFSET_MINUTES = Number(process.env.ADMS_CLOCK_OFFSET_MINUTES ?? -2);

export type AdmsReply = { status: number; text: string };

async function directDevice(serial: string) {
  if (!serial || serial.length > 40) return null;
  const d = await db.attendanceDevice.findUnique({ where: { serialNumber: serial } });
  return d && d.directPush && d.isActive ? d : null;
}

export async function handleAdms(method: string, path: string, params: URLSearchParams, body: string): Promise<AdmsReply> {
  if (path === "/iclock/ping") return { status: 200, text: "OK" };
  const serial = (params.get("SN") ?? "").trim();
  const device = await directDevice(serial);
  if (!device) {
    if (serial) console.warn(`ADMS: rejected ${method} ${path} from serial ${serial.slice(0, 40)}`);
    return { status: 403, text: "Forbidden" };
  }
  const touch = (data: Record<string, unknown> = {}) =>
    db.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...data } });
  const pushver = params.get("pushver");

  if (path === "/iclock/cdata" && method === "GET") {
    await touch(pushver ? { pushVersion: pushver.slice(0, 20) } : {});
    console.log(`ADMS: handshake from ${serial} (pushver ${pushver ?? "?"})`);
    return { status: 200, text: handshakeText(serial, device.attlogStamp, TIMEZONE_HOURS) };
  }

  if (path === "/iclock/cdata" && method === "POST") {
    const table = (params.get("table") ?? "").toUpperCase();
    if (table === "ATTLOG") {
      const records = parseAttlog(serial, body);
      const punches: ParsedPunch[] = [];
      for (const r of records) {
        const p = punchFromDeviceRecord(r);
        if (p && p.punchedAt.getTime() <= Date.now() + 24 * 3_600_000) punches.push(p);
      }
      const { inserted } = await ingestPunches(punches, "AGENT");
      const latest = punches.reduce((m, p) => (p.punchedAt > m ? p.punchedAt : m), new Date(0));
      const stamp = params.get("Stamp");
      await touch({
        ...(latest.getTime() > 0 && (!device.lastPunchAt || latest > device.lastPunchAt) ? { lastPunchAt: latest } : {}),
        ...(stamp ? { attlogStamp: stamp.slice(0, 40) } : {}),
      });
      console.log(`ADMS: ATTLOG from ${serial}: ${records.length} records, ${inserted} new`);
      return { status: 200, text: `OK: ${records.length}` };
    }
    if (table === "OPTIONS" || table === "INFO") {
      const info = parseInfo(body);
      await touch({ model: info.DeviceName ?? undefined, firmware: info.FWVersion ?? info.FirmVer ?? undefined });
    } else await touch();
    // OPERLOG, photos, users, templates: acknowledged, deliberately not stored.
    return { status: 200, text: "OK" };
  }

  if (path === "/iclock/getrequest") {
    const info = params.get("INFO");
    await touch(info ? { firmware: info.split(",")[0]?.slice(0, 100) || undefined } : {});
    const pending = await db.agentCommand.findMany({
      where: { agentId: null, deviceSerial: serial, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
    if (pending.length === 0) return { status: 200, text: "OK" };
    const lines: string[] = [];
    for (const c of pending) {
      const no = 100_000 + Math.floor(Math.random() * 899_999_999);
      await db.agentCommand.update({ where: { id: c.id }, data: { status: "SENT", sentAt: new Date(), deviceCmdNo: no } });
      lines.push(commandLine(no, c.type, c.payload));
    }
    console.log(`ADMS: sent ${lines.length} command(s) to ${serial}`);
    return { status: 200, text: lines.join("\n") };
  }

  if (path === "/iclock/devicecmd") {
    for (const line of body.split(/\r?\n/).filter(Boolean)) {
      const p = new URLSearchParams(line);
      const no = Number(p.get("ID"));
      const ret = p.get("Return") ?? "";
      if (!no) continue;
      await db.agentCommand.updateMany({
        where: { agentId: null, deviceSerial: serial, deviceCmdNo: no },
        data: {
          status: Number(ret) >= 0 ? "DONE" : "FAILED",
          result: `Return=${ret} CMD=${p.get("CMD") ?? ""}`.slice(0, 500),
          completedAt: new Date(),
        },
      });
    }
    await touch();
    return { status: 200, text: "OK" };
  }

  // Push protocol 3.x endpoints.
  if (path === "/iclock/registry") return { status: 200, text: `RegistryCode=${serial.slice(-8)}` };
  if (path === "/iclock/push") {
    return { status: 200, text: handshakeText(serial, device.attlogStamp, TIMEZONE_HOURS, ["ServerVersion=3.1.2", "PushProtVer=3.1.2"]) };
  }
  return { status: 200, text: "OK" };
}
