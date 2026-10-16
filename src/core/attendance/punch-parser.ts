// Parses attendance log exports into punches. Supported formats:
//   * ZKTeco USB download "attlog.dat" / "1_attlog.dat": tab/space separated  <userId> <YYYY-MM-DD HH:mm:ss> <state> <verify> ...
//   * CSV / tab-separated exports with a header row (e.g. ZKBioTime transaction export saved as CSV).
//     Columns are recognised by name: user/employee/person ID, date + time (or a combined date-time),
//     and optionally device serial and punch state.
// Times in the file are device local time (Pakistan time).

import { PKT_OFFSET_MIN } from "./engine";

export type ParsedPunch = {
  deviceUserId: string;
  local: string; // "YYYY-MM-DD HH:mm:ss"
  punchedAt: Date;
  deviceSerial: string;
  punchState: string | null;
  verifyMode: string | null;
};

export type ParseResult = { format: "attlog" | "csv"; punches: ParsedPunch[]; invalid: number; errors: string[] };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const USER_COLUMNS = ["userid", "employeeid", "empid", "empcode", "employeecode", "empno", "employeeno", "personid", "personnelid", "personnelno", "acno", "pin", "enrollnumber", "enrollno", "badgenumber", "user", "id", "no"];
const DATETIME_COLUMNS = ["punchtime", "checktime", "datetime", "timestamp", "attendancetime", "logtime", "transactiontime"];
const DATE_COLUMNS = ["date", "punchdate", "attdate", "logdate"];
const TIME_COLUMNS = ["time", "punchtimeonly", "logtime"];
const SERIAL_COLUMNS = ["serialnumber", "terminalsn", "devicesn", "deviceserial", "sn", "terminalserial"];
const STATE_COLUMNS = ["punchstate", "state", "checktype", "inout", "attstate"];
const VERIFY_COLUMNS = ["verifytype", "verifymode", "verify", "verification"];

function findColumn(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

/** Minimal RFC 4180 line splitter supporting quotes. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Parse a date in YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY or DD-MM-YYYY (Pakistan uses day-first). */
function parseDatePart(value: string): [number, number, number] | null {
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (m) return [Number(m[3]), Number(m[2]), Number(m[1])];
  return null;
}

function parseTimePart(value: string): [number, number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(value.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const meridiem = m[4]?.toLowerCase();
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    if (meridiem === "pm" && h !== 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
  }
  const min = Number(m[2]);
  const s = Number(m[3] ?? 0);
  if (h > 23 || min > 59 || s > 59) return null;
  return [h, min, s];
}

function buildPunch(date: [number, number, number], time: [number, number, number]): { local: string; punchedAt: Date } | null {
  const [y, mo, d] = date;
  const [h, mi, s] = time;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  if (y < 2000) return null;
  const local = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return { local, punchedAt: new Date(utc - PKT_OFFSET_MIN * 60_000) };
}

function parseDateTime(value: string): { local: string; punchedAt: Date } | null {
  const m = /^(\S+)[\sT]+(.+)$/.exec(value.trim());
  if (!m) return null;
  const date = parseDatePart(m[1]!);
  const time = parseTimePart(m[2]!);
  return date && time ? buildPunch(date, time) : null;
}

/** Build a punch from a device record (local Pakistan time "YYYY-MM-DD HH:mm:ss"), or null if the time is invalid. */
export function punchFromDeviceRecord(r: { serial: string; pin: string; local: string; state?: string | null; verify?: string | null }): ParsedPunch | null {
  const dt = parseDateTime(r.local);
  const pin = r.pin.trim();
  if (!dt || !pin || pin.length > 20) return null;
  return { deviceUserId: pin, ...dt, deviceSerial: r.serial.trim().slice(0, 40), punchState: r.state ?? null, verifyMode: r.verify ?? null };
}

export function parsePunchFile(text: string, now: Date = new Date()): ParseResult {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const errors: string[] = [];
  const punches: ParsedPunch[] = [];
  let invalid = 0;
  const latestAllowed = now.getTime() + 24 * 3_600_000;

  const reject = (lineNo: number, reason: string) => {
    invalid++;
    if (errors.length < 10) errors.push(`Line ${lineNo}: ${reason}`);
  };
  const accept = (p: ParsedPunch, lineNo: number) => {
    if (p.punchedAt.getTime() > latestAllowed) return reject(lineNo, "time is in the future");
    punches.push(p);
  };

  const first = lines[0] ?? "";
  const attlogLine = /^\s*(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)(?:\s+(\S+))?(?:\s+(\S+))?/;
  if (attlogLine.test(first)) {
    lines.forEach((line, i) => {
      const m = attlogLine.exec(line);
      const dt = m ? parseDateTime(m[2]!) : null;
      if (!m || !dt) return reject(i + 1, "not a valid attendance log line");
      accept({ deviceUserId: m[1]!, ...dt, deviceSerial: "", punchState: m[3] ?? null, verifyMode: m[4] ?? null }, i + 1);
    });
    return { format: "attlog", punches, invalid, errors };
  }

  const delimiter = [",", "\t", ";"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const headers = splitDelimited(first, delimiter).map(norm);
  const col = {
    user: findColumn(headers, USER_COLUMNS),
    datetime: findColumn(headers, DATETIME_COLUMNS),
    date: findColumn(headers, DATE_COLUMNS),
    time: findColumn(headers, TIME_COLUMNS),
    serial: findColumn(headers, SERIAL_COLUMNS),
    state: findColumn(headers, STATE_COLUMNS),
    verify: findColumn(headers, VERIFY_COLUMNS),
  };
  if (col.user < 0 || (col.datetime < 0 && (col.date < 0 || col.time < 0))) {
    return {
      format: "csv",
      punches: [],
      invalid: Math.max(0, lines.length - 1),
      errors: ["Could not find the user ID and date/time columns. Expected headers such as “User ID”, “Date” and “Time” (or “Punch Time”)."],
    };
  }

  lines.slice(1).forEach((line, i) => {
    const lineNo = i + 2;
    const cells = splitDelimited(line, delimiter);
    const userId = cells[col.user]?.replace(/^0+(?=\d)/, "") ?? "";
    if (!userId) return reject(lineNo, "missing user ID");

    let dt: { local: string; punchedAt: Date } | null = null;
    if (col.datetime >= 0) dt = parseDateTime(cells[col.datetime] ?? "");
    if (!dt && col.date >= 0 && col.time >= 0) {
      const date = parseDatePart(cells[col.date] ?? "");
      const timeCell = cells[col.time] ?? "";
      const time = parseTimePart(timeCell) ?? (parseDateTime(timeCell) ? parseTimePart(timeCell.split(/\s+/).slice(1).join(" ")) : null);
      if (date && time) dt = buildPunch(date, time);
    }
    if (!dt) return reject(lineNo, "invalid date/time");

    accept(
      {
        deviceUserId: userId,
        ...dt,
        deviceSerial: col.serial >= 0 ? (cells[col.serial] ?? "") : "",
        punchState: col.state >= 0 ? (cells[col.state] || null) : null,
        verifyMode: col.verify >= 0 ? (cells[col.verify] || null) : null,
      },
      lineNo,
    );
  });
  return { format: "csv", punches, invalid, errors };
}
