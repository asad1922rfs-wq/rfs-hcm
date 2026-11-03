// ZKTeco ADMS ("push") protocol helpers for the direct /iclock receiver (machine → website, no office PC).

export type AdmsRecord = { serial: string; pin: string; local: string; state: string | null; verify: string | null };

/** ATTLOG body: one record per line, `PIN \t YYYY-MM-DD HH:mm:ss \t state \t verify ...`. */
export function parseAttlog(serial: string, body: string): AdmsRecord[] {
  const out: AdmsRecord[] = [];
  for (const line of body.split(/\r?\n/)) {
    const cols = line.split("\t");
    const pin = cols[0]?.trim();
    const local = cols[1]?.trim();
    if (!pin || !local || !/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(:\d{2})?$/.test(local)) continue;
    out.push({ serial, pin, local, state: cols[2]?.trim() || null, verify: cols[3]?.trim() || null });
  }
  return out;
}

/** "~DeviceName=MB460,FWVersion=Ver 8.0.4.2,..." or newline/ampersand separated key=value pairs. */
export function parseInfo(text: string): Record<string, string> {
  const info: Record<string, string> = {};
  for (const part of text.split(/[,\n&]/)) {
    const i = part.indexOf("=");
    if (i > 0) info[part.slice(0, i).trim().replace(/^~/, "")] = part.slice(i + 1).trim().slice(0, 200);
  }
  return info;
}

export function handshakeText(serial: string, attlogStamp: string | null, timezoneHours: number, extra: string[] = []): string {
  return [
    `GET OPTION FROM: ${serial}`,
    `ATTLOGStamp=${attlogStamp ?? "None"}`,
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;12:00",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    `TimeZone=${timezoneHours}`,
    "Realtime=1",
    "Encrypt=None",
    ...extra,
  ].join("\n");
}

/** Device command line for a queued command. */
export function commandLine(no: number, type: string, payload: unknown): string {
  if (type === "RESYNC_ATTLOG") {
    const p = (payload ?? {}) as { from?: string; to?: string };
    return `C:${no}:DATA QUERY ATTLOG StartTime=${p.from}\tEndTime=${p.to}`;
  }
  if (type === "REBOOT") return `C:${no}:REBOOT`;
  return `C:${no}:INFO`;
}
