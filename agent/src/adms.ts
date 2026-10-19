// ZKTeco ADMS ("push") protocol receiver.
//
// The device is configured with this PC's LAN address and port (Comm → Cloud Server Settings), and then:
//   GET  /iclock/cdata?SN=..&options=all          handshake; we reply with upload options
//   POST /iclock/cdata?SN=..&table=ATTLOG&Stamp=  attendance records, one per line:  PIN \t YYYY-MM-DD HH:mm:ss \t state \t verify ...
//   POST /iclock/cdata?SN=..&table=OPERLOG/...    other tables — acknowledged and discarded
//   GET  /iclock/getrequest?SN=..                  polls for commands (we answer "OK" or "C:<id>:<command>")
//   POST /iclock/devicecmd?SN=..                   command results
// Newer firmware (push protocol 3.x) may also call /iclock/registry and /iclock/push; both are answered.
// Every request is written to data/adms-raw.log (bodies truncated) so behaviour can be verified on real hardware.
//
// Biometric templates (fingerprint/face) are never requested and never stored.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./config.ts";
import type { DeviceRecord, Outbox } from "./outbox.ts";

const MAX_BODY = 4 * 1024 * 1024;
const RAW_LOG_MAX = 5 * 1024 * 1024;

export function parseAttlog(serial: string, body: string): DeviceRecord[] {
  const out: DeviceRecord[] = [];
  for (const line of body.split(/\r?\n/)) {
    const cols = line.split("\t");
    const pin = cols[0]?.trim();
    const local = cols[1]?.trim();
    if (!pin || !local || !/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(:\d{2})?$/.test(local)) continue;
    out.push({ serial, pin, local, state: cols[2]?.trim() || null, verify: cols[3]?.trim() || null });
  }
  return out;
}

/** "~DeviceName=MB460 Plus,FWVersion=Ver 8.0.4.2,..." or newline/ampersand separated key=value pairs. */
export function parseInfo(text: string): Record<string, string> {
  const info: Record<string, string> = {};
  for (const part of text.split(/[,\n&]/)) {
    const i = part.indexOf("=");
    if (i > 0) info[part.slice(0, i).trim().replace(/^~/, "")] = part.slice(i + 1).trim().slice(0, 200);
  }
  return info;
}

export function startAdmsServer(cfg: AgentConfig, outbox: Outbox, log: (msg: string) => void) {
  const rawLogPath = join(cfg.dataDir, "adms-raw.log");
  const rawLog = (line: string) => {
    try {
      const size = statSync(rawLogPath, { throwIfNoEntry: false })?.size ?? 0;
      if (size > RAW_LOG_MAX) renameSync(rawLogPath, `${rawLogPath}.1`);
      appendFileSync(rawLogPath, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* logging must never break attendance */
    }
  };

  const handshake = (serial: string, extra: string[] = []) => {
    const stamps = outbox.getStamps(serial);
    return [
      `GET OPTION FROM: ${serial}`,
      `ATTLOGStamp=${stamps.attlog ?? "None"}`,
      `OPERLOGStamp=9999`,
      `ATTPHOTOStamp=None`,
      `ErrorDelay=30`,
      `Delay=10`,
      `TransTimes=00:00;12:00`,
      `TransInterval=1`,
      `TransFlag=TransData AttLog`,
      `TimeZone=${cfg.timezoneHours}`,
      `Realtime=1`,
      `Encrypt=None`,
      ...extra,
    ].join("\n");
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reply = (status: number, text: string) => {
      // The device sets its clock from this header, so it follows this PC's (internet-synced) time plus the offset.
      const deviceNow = new Date(Date.now() + cfg.deviceClockOffsetMinutes * 60_000);
      res.writeHead(status, { "Content-Type": "text/plain", Connection: "close", Date: deviceNow.toUTCString() });
      res.end(text);
    };
    try {
      const url = new URL(req.url ?? "/", "http://device");
      const serial = (url.searchParams.get("SN") ?? "").trim();
      const body = await readBody(req);
      rawLog(`${req.socket.remoteAddress} ${req.method} ${url.pathname}${url.search} ${body.length ? JSON.stringify(body.slice(0, 2000)) : ""}`);

      if (!url.pathname.startsWith("/iclock/")) return reply(404, "Not found");
      // Connectivity check — does not register a device.
      if (url.pathname.replace(/\/+$/, "") === "/iclock/ping") return reply(200, "OK");
      if (!serial) return reply(400, "SN required");
      if (cfg.allowedSerials.length && !cfg.allowedSerials.includes(serial)) {
        log(`Rejected device ${serial} (not in allowedSerials)`);
        return reply(403, "Forbidden");
      }
      outbox.touchDevice(serial, url.searchParams.get("pushver"));
      const path = url.pathname.replace(/\/+$/, "");

      if (path === "/iclock/cdata" && req.method === "GET") {
        log(`Handshake from ${serial} (${req.socket.remoteAddress}, pushver ${url.searchParams.get("pushver") ?? "?"})`);
        return reply(200, handshake(serial));
      }

      if (path === "/iclock/cdata" && req.method === "POST") {
        const table = (url.searchParams.get("table") ?? "").toUpperCase();
        if (table === "ATTLOG") {
          const records = parseAttlog(serial, body);
          const added = outbox.addPunches(records);
          const stamp = url.searchParams.get("Stamp");
          if (stamp) outbox.setStamp(serial, "attlog", stamp);
          log(`ATTLOG from ${serial}: ${records.length} records, ${added} new`);
          return reply(200, `OK: ${records.length}`);
        }
        if (table === "OPTIONS" || table === "INFO") outbox.setDeviceInfo(serial, parseInfo(body));
        // OPERLOG, ATTPHOTO, USERINFO, templates, etc.: acknowledged, deliberately not stored.
        return reply(200, "OK");
      }

      if (path === "/iclock/getrequest") {
        const info = url.searchParams.get("INFO");
        if (info) outbox.setDeviceInfo(serial, { INFO: info });
        const commands = outbox.takeQueuedFor(serial);
        if (commands.length === 0) return reply(200, "OK");
        const lines = commands.map((c) => {
          if (c.type === "RESYNC_ATTLOG") {
            const p = c.payload as { from?: string; to?: string };
            return `C:${c.deviceCmdId}:DATA QUERY ATTLOG StartTime=${p.from}\tEndTime=${p.to}`;
          }
          if (c.type === "REBOOT") return `C:${c.deviceCmdId}:REBOOT`;
          return `C:${c.deviceCmdId}:INFO`;
        });
        log(`Sent ${lines.length} command(s) to ${serial}`);
        return reply(200, lines.join("\n"));
      }

      if (path === "/iclock/devicecmd") {
        for (const line of body.split(/\r?\n/).filter(Boolean)) {
          const p = new URLSearchParams(line);
          const id = Number(p.get("ID"));
          const ret = p.get("Return") ?? "";
          if (id) outbox.completeDeviceCommand(id, Number(ret) >= 0, `Return=${ret} CMD=${p.get("CMD") ?? ""}`);
        }
        return reply(200, "OK");
      }

      // Push protocol 3.x endpoints.
      if (path === "/iclock/registry") return reply(200, `RegistryCode=${serial.slice(-8)}`);
      if (path === "/iclock/push") return reply(200, handshake(serial, ["ServerVersion=3.1.2", "PushProtVer=3.1.2"]));
      if (path === "/iclock/querydata") return reply(200, "OK");

      return reply(200, "OK");
    } catch (err) {
      log(`ADMS error: ${err instanceof Error ? err.message : String(err)}`);
      reply(500, "ERROR");
    }
  });

  server.listen(cfg.listenPort, cfg.listenHost, () => log(`ADMS receiver listening on ${cfg.listenHost}:${cfg.listenPort}`));
  return server;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
