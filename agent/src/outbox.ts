// Durable local store. Punches are written here before the device gets "OK", and removed from the
// pending set only after the server confirms them, so an internet outage never loses attendance.

import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export type DeviceRecord = { serial: string; pin: string; local: string; state: string | null; verify: string | null };
export type QueuedCommand = { id: string; serial: string; type: string; payload: Record<string, unknown> };

export class Outbox {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(join(dataDir, "agent.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS punches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serial TEXT NOT NULL, pin TEXT NOT NULL, local TEXT NOT NULL,
        state TEXT, verify TEXT,
        received_at TEXT NOT NULL DEFAULT (datetime('now')),
        sent_at TEXT,
        UNIQUE(serial, pin, local)
      );
      CREATE INDEX IF NOT EXISTS punches_pending ON punches(sent_at) WHERE sent_at IS NULL;
      CREATE TABLE IF NOT EXISTS devices (
        serial TEXT PRIMARY KEY, last_seen TEXT NOT NULL, push_version TEXT, info TEXT,
        attlog_stamp TEXT, operlog_stamp TEXT
      );
      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY, serial TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL,
        device_cmd_id INTEGER, status TEXT NOT NULL DEFAULT 'queued', result TEXT, reported INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS seq (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
    `);
  }

  /** Returns how many were new (duplicates from device re-sends are ignored). */
  addPunches(records: DeviceRecord[]): number {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO punches(serial, pin, local, state, verify) VALUES (?, ?, ?, ?, ?)");
    let added = 0;
    this.db.exec("BEGIN");
    try {
      for (const r of records) added += Number(stmt.run(r.serial, r.pin, r.local, r.state, r.verify).changes);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return added;
  }

  pending(limit: number): (DeviceRecord & { id: number })[] {
    return this.db
      .prepare("SELECT id, serial, pin, local, state, verify FROM punches WHERE sent_at IS NULL ORDER BY id LIMIT ?")
      .all(limit) as unknown as (DeviceRecord & { id: number })[];
  }

  markSent(ids: number[]) {
    const stmt = this.db.prepare("UPDATE punches SET sent_at = datetime('now') WHERE id = ?");
    this.db.exec("BEGIN");
    for (const id of ids) stmt.run(id);
    this.db.exec("COMMIT");
  }

  pendingCount(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM punches WHERE sent_at IS NULL").get() as { n: number }).n);
  }

  touchDevice(serial: string, pushVersion: string | null) {
    this.db
      .prepare(
        `INSERT INTO devices(serial, last_seen, push_version) VALUES (?, ?, ?)
         ON CONFLICT(serial) DO UPDATE SET last_seen = excluded.last_seen, push_version = COALESCE(excluded.push_version, devices.push_version)`,
      )
      .run(serial, new Date().toISOString(), pushVersion);
  }

  /** Merges new key/values into what the device reported earlier (options upload + getrequest INFO). */
  setDeviceInfo(serial: string, info: Record<string, string>) {
    this.touchDevice(serial, null);
    const row = this.db.prepare("SELECT info FROM devices WHERE serial = ?").get(serial) as { info: string | null } | undefined;
    const merged = { ...(row?.info ? (JSON.parse(row.info) as Record<string, string>) : {}), ...info };
    this.db.prepare("UPDATE devices SET info = ? WHERE serial = ?").run(JSON.stringify(merged), serial);
  }

  forgetDevice(serial: string) {
    this.db.prepare("DELETE FROM devices WHERE serial = ?").run(serial);
  }

  getStamps(serial: string): { attlog: string | null; operlog: string | null } {
    const row = this.db.prepare("SELECT attlog_stamp, operlog_stamp FROM devices WHERE serial = ?").get(serial) as
      | { attlog_stamp: string | null; operlog_stamp: string | null }
      | undefined;
    return { attlog: row?.attlog_stamp ?? null, operlog: row?.operlog_stamp ?? null };
  }

  setStamp(serial: string, table: "attlog" | "operlog", stamp: string) {
    this.touchDevice(serial, null);
    this.db.prepare(`UPDATE devices SET ${table}_stamp = ? WHERE serial = ?`).run(stamp, serial);
  }

  devices(): { serial: string; lastSeenAt: string; pushVersion: string | null; info: Record<string, string> | null }[] {
    const rows = this.db.prepare("SELECT serial, last_seen, push_version, info FROM devices").all() as {
      serial: string; last_seen: string; push_version: string | null; info: string | null;
    }[];
    return rows.map((r) => ({ serial: r.serial, lastSeenAt: r.last_seen, pushVersion: r.push_version, info: r.info ? JSON.parse(r.info) : null }));
  }

  // ── Commands from the server, delivered to the device through /iclock/getrequest ──

  queueCommand(cmd: QueuedCommand) {
    this.db
      .prepare("INSERT OR IGNORE INTO commands(id, serial, type, payload) VALUES (?, ?, ?, ?)")
      .run(cmd.id, cmd.serial, cmd.type, JSON.stringify(cmd.payload));
  }

  nextDeviceCommandId(): number {
    this.db.prepare("INSERT INTO seq(name, value) VALUES ('cmd', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1").run();
    return Number((this.db.prepare("SELECT value FROM seq WHERE name = 'cmd'").get() as { value: number }).value);
  }

  takeQueuedFor(serial: string): (QueuedCommand & { deviceCmdId: number })[] {
    const rows = this.db.prepare("SELECT id, serial, type, payload FROM commands WHERE serial = ? AND status = 'queued'").all(serial) as {
      id: string; serial: string; type: string; payload: string;
    }[];
    return rows.map((r) => {
      const deviceCmdId = this.nextDeviceCommandId();
      this.db.prepare("UPDATE commands SET status = 'sent', device_cmd_id = ? WHERE id = ?").run(deviceCmdId, r.id);
      return { id: r.id, serial: r.serial, type: r.type, payload: JSON.parse(r.payload), deviceCmdId };
    });
  }

  completeDeviceCommand(deviceCmdId: number, ok: boolean, result: string) {
    this.db.prepare("UPDATE commands SET status = ?, result = ? WHERE device_cmd_id = ?").run(ok ? "done" : "failed", result, deviceCmdId);
  }

  unreportedResults(): { id: string; ok: boolean; message: string }[] {
    const rows = this.db.prepare("SELECT id, status, result FROM commands WHERE status IN ('done','failed') AND reported = 0").all() as {
      id: string; status: string; result: string | null;
    }[];
    return rows.map((r) => ({ id: r.id, ok: r.status === "done", message: r.result ?? "" }));
  }

  markReported(ids: string[]) {
    for (const id of ids) this.db.prepare("UPDATE commands SET reported = 1 WHERE id = ?").run(id);
  }
}
