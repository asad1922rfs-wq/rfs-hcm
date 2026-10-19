import { describe, expect, it } from "vitest";
import { applyAdjustment, computeDay, dedupePunches, excuseAdjusted, instantAt, ruleForDate, workDateOf } from "@/core/attendance/engine";
import { parsePunchFile } from "@/core/attendance/punch-parser";

const SHIFT = { startMinute: 14 * 60, endMinute: 23 * 60, graceMinutes: 15 }; // RFS: 2 PM – 11 PM
/** PKT local time → UTC instant */
const pkt = (s: string) => new Date(Date.parse(`${s.replace(" ", "T")}Z`) - 5 * 3_600_000);

describe("workDateOf", () => {
  it("keeps normal punches on their calendar day", () => {
    expect(workDateOf(pkt("2026-10-01 13:55:00"), SHIFT)).toBe("2026-10-01");
    expect(workDateOf(pkt("2026-10-01 23:10:00"), SHIFT)).toBe("2026-10-01");
  });

  it("assigns check-outs after midnight to the previous work day", () => {
    expect(workDateOf(pkt("2026-10-02 00:40:00"), SHIFT)).toBe("2026-10-01");
    expect(workDateOf(pkt("2026-10-02 05:59:00"), SHIFT)).toBe("2026-10-01");
  });

  it("does not pull mid-morning punches back a day", () => {
    expect(workDateOf(pkt("2026-10-02 09:00:00"), SHIFT)).toBe("2026-10-02");
  });
});

describe("manual adjustments", () => {
  const d = "2026-10-14";
  it("adjusted times replace the machine's", () => {
    const eff = applyAdjustment([pkt("2026-10-14 14:40:00"), pkt("2026-10-14 23:05:00")], { checkIn: pkt("2026-10-14 14:05:00"), checkOut: null });
    expect(eff.map((x) => x.toISOString())).toEqual([pkt("2026-10-14 14:05:00").toISOString(), pkt("2026-10-14 23:05:00").toISOString()]);
    expect(computeDay(d, eff, SHIFT, false)!.status).toBe("PRESENT");
  });

  it("fills a missing check-out", () => {
    const eff = applyAdjustment([pkt("2026-10-14 14:00:00")], { checkIn: null, checkOut: pkt("2026-10-14 23:00:00") });
    expect(computeDay(d, eff, SHIFT, false)).toMatchObject({ status: "PRESENT", workedMinutes: 540 });
  });

  it("creates a day with no machine punches", () => {
    const eff = applyAdjustment([], { checkIn: pkt("2026-10-14 14:00:00"), checkOut: pkt("2026-10-14 23:00:00") });
    expect(computeDay(d, eff, SHIFT, false)!.workedMinutes).toBe(540);
  });

  it("does not treat a punch right after the adjusted check-in as the check-out", () => {
    const eff = applyAdjustment([pkt("2026-10-14 14:10:00")], { checkIn: pkt("2026-10-14 14:00:00"), checkOut: null });
    expect(computeDay(d, eff, SHIFT, false)!.status).toBe("MISSING");
  });

  it("a machine punch after the adjusted check-out is never used as the check-in", () => {
    const eff = applyAdjustment([pkt("2026-10-14 23:25:00")], { checkIn: null, checkOut: pkt("2026-10-14 20:00:00") });
    expect(eff.map((x) => x.toISOString())).toEqual([pkt("2026-10-14 20:00:00").toISOString()]);
    expect(computeDay(d, eff, SHIFT, false)!.status).toBe("MISSING"); // becomes PRESENT only when the edit is excused
  });

  it("bulk early off keeps the real machine check-in", () => {
    const eff = applyAdjustment([pkt("2026-10-14 14:10:00"), pkt("2026-10-14 23:17:00")], { checkIn: null, checkOut: pkt("2026-10-14 20:00:00") });
    expect(computeDay(d, eff, SHIFT, false)).toMatchObject({ workedMinutes: 350, earlyLeaveMinutes: 180 });
  });

  it("instantAt handles times after midnight", () => {
    expect(instantAt(d, 24 * 60 + 30).toISOString()).toBe(pkt("2026-10-15 00:30:00").toISOString());
  });
});

describe("weekday overrides (RFS Friday 3 PM – 12 AM)", () => {
  // 2026-10-16 is a Friday, 2026-10-15 a Thursday.
  const RFS = { ...SHIFT, overrides: [{ weekday: 5, startMinute: 15 * 60, endMinute: 0, graceMinutes: null }] };

  it("uses Friday's timing on Fridays only, inheriting the 15-minute grace", () => {
    expect(ruleForDate(RFS, "2026-10-16")).toEqual({ startMinute: 900, endMinute: 0, graceMinutes: 15 });
    expect(ruleForDate(RFS, "2026-10-15")).toEqual({ startMinute: 840, endMinute: 1380, graceMinutes: 15 });
  });

  it("Friday 3:10 PM is on time, 3:16 PM is late; leaving at midnight is not early", () => {
    const fri = ruleForDate(RFS, "2026-10-16");
    expect(computeDay("2026-10-16", [pkt("2026-10-16 15:10:00"), pkt("2026-10-17 00:00:00")], fri, false)!).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0 });
    expect(computeDay("2026-10-16", [pkt("2026-10-16 15:16:00"), pkt("2026-10-17 00:05:00")], fri, false)!).toMatchObject({ status: "LATE", lateMinutes: 16 });
    expect(computeDay("2026-10-16", [pkt("2026-10-16 15:00:00"), pkt("2026-10-16 23:30:00")], fri, false)!).toMatchObject({ status: "EARLY", earlyLeaveMinutes: 30 });
  });

  it("Friday-night check-outs after midnight belong to Friday", () => {
    expect(workDateOf(pkt("2026-10-17 00:20:00"), RFS)).toBe("2026-10-16");
    expect(workDateOf(pkt("2026-10-17 06:50:00"), RFS)).toBe("2026-10-16");
    expect(workDateOf(pkt("2026-10-16 01:00:00"), RFS)).toBe("2026-10-15"); // Thursday night check-out
  });
});

describe("computeDay", () => {
  it("on time, full shift = present with 9 hours worked", () => {
    const r = computeDay("2026-10-01", [pkt("2026-10-01 13:58:00"), pkt("2026-10-01 23:02:00")], SHIFT, false)!;
    expect(r).toMatchObject({ status: "PRESENT", workedMinutes: 544, lateMinutes: 0, earlyLeaveMinutes: 0 });
  });

  it("within grace (2:15 PM) is not late", () => {
    expect(computeDay("2026-10-01", [pkt("2026-10-01 14:15:00"), pkt("2026-10-01 23:00:00")], SHIFT, false)!.status).toBe("PRESENT");
  });

  it("after grace (2:16 PM) is late, measured from shift start", () => {
    const r = computeDay("2026-10-01", [pkt("2026-10-01 14:16:00"), pkt("2026-10-01 23:00:00")], SHIFT, false)!;
    expect(r).toMatchObject({ status: "LATE", lateMinutes: 16 });
  });

  it("leaving before 11 PM is early", () => {
    const r = computeDay("2026-10-01", [pkt("2026-10-01 14:00:00"), pkt("2026-10-01 22:30:00")], SHIFT, false)!;
    expect(r).toMatchObject({ status: "EARLY", earlyLeaveMinutes: 30 });
  });

  it("checking out after midnight counts the full time", () => {
    const r = computeDay("2026-10-01", [pkt("2026-10-01 14:00:00"), pkt("2026-10-02 00:30:00")], SHIFT, false)!;
    expect(r).toMatchObject({ status: "PRESENT", workedMinutes: 630, earlyLeaveMinutes: 0 });
  });

  it("a single punch is a missing punch", () => {
    expect(computeDay("2026-10-01", [pkt("2026-10-01 14:00:00")], SHIFT, false)!.status).toBe("MISSING");
  });

  it("a single punch during today's shift means checked in, not missing", () => {
    expect(computeDay("2026-10-16", [pkt("2026-10-16 13:57:00")], SHIFT, false, true)!.status).toBe("PRESENT");
    expect(computeDay("2026-10-16", [pkt("2026-10-16 14:30:00")], SHIFT, false, true)!.status).toBe("LATE");
  });

  it("double taps are merged", () => {
    expect(dedupePunches([pkt("2026-10-01 14:00:00"), pkt("2026-10-01 14:00:40")])).toHaveLength(1);
    expect(computeDay("2026-10-01", [pkt("2026-10-01 14:00:00"), pkt("2026-10-01 14:01:00")], SHIFT, false)!.status).toBe("MISSING");
  });

  it("punches on an off day are present, never late", () => {
    const r = computeDay("2026-10-03", [pkt("2026-10-03 16:00:00"), pkt("2026-10-03 20:00:00")], SHIFT, true)!;
    expect(r).toMatchObject({ status: "PRESENT", lateMinutes: 0, workedMinutes: 240 });
  });

  it("no punches = no result (the caller decides absent vs not yet synced)", () => {
    expect(computeDay("2026-10-01", [], SHIFT, false)).toBeNull();
  });
});

describe("parsePunchFile", () => {
  const now = new Date("2026-10-16T12:00:00Z");

  it("parses ZKTeco attlog.dat", () => {
    const text = "      101\t2026-10-01 14:05:33\t0\t1\t0\t0\n      101\t2026-10-01 23:01:10\t1\t1\t0\t0\n";
    const r = parsePunchFile(text, now);
    expect(r.format).toBe("attlog");
    expect(r.punches).toHaveLength(2);
    expect(r.punches[0]).toMatchObject({ deviceUserId: "101", local: "2026-10-01 14:05:33", punchState: "0" });
    expect(r.punches[0]!.punchedAt.toISOString()).toBe("2026-10-01T09:05:33.000Z");
  });

  it("parses CSV with separate date/time columns, day-first dates and AM/PM", () => {
    const text = 'Employee ID,First Name,Date,Time,Punch State,Terminal SN\n"0101","Ayesha","01/10/2026","2:05 PM","Check In","CQZ7232"\n';
    const r = parsePunchFile(text, now);
    expect(r.punches[0]).toMatchObject({ deviceUserId: "101", local: "2026-10-01 14:05:00", deviceSerial: "CQZ7232", punchState: "Check In" });
  });

  it("parses CSV with a combined punch time column", () => {
    const r = parsePunchFile("Person ID,Punch Time\n101,2026-10-01 14:05:33\n", now);
    expect(r.punches[0]!.local).toBe("2026-10-01 14:05:33");
  });

  it("rejects bad rows and future punches without failing the file", () => {
    const r = parsePunchFile("User ID,Punch Time\n101,2026-13-40 10:00\n101,2027-01-01 10:00:00\n102,2026-10-02 14:00:00\n", now);
    expect(r.punches).toHaveLength(1);
    expect(r.invalid).toBe(2);
  });

  it("explains unrecognised headers", () => {
    const r = parsePunchFile("Foo,Bar\n1,2\n", now);
    expect(r.punches).toHaveLength(0);
    expect(r.errors[0]).toMatch(/user ID/);
  });
});

describe("excused adjustments", () => {
  const d = "2026-10-09";
  const FRIDAY = { startMinute: 15 * 60, endMinute: 24 * 60, graceMinutes: 15 }; // 3 PM – 12 AM
  const machine = [pkt("2026-10-09 15:20:00")];

  it("only a check-out edited: a late machine check-in still counts as late", () => {
    const adj = { checkIn: null, checkOut: pkt("2026-10-10 00:15:00") };
    const day = computeDay(d, applyAdjustment(machine, adj), FRIDAY, false)!;
    expect(excuseAdjusted(day, adj, FRIDAY)).toMatchObject({ status: "LATE", lateMinutes: 20, earlyLeaveMinutes: 0 });
  });

  it("an early check-out is excused when the check-out was edited", () => {
    const adj = { checkIn: null, checkOut: pkt("2026-10-09 21:00:00") };
    const day = computeDay(d, applyAdjustment([pkt("2026-10-09 15:05:00")], adj), FRIDAY, false)!;
    expect(day.status).toBe("EARLY");
    expect(excuseAdjusted(day, adj, FRIDAY)).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0 });
  });

  it("an edited check-in is never late", () => {
    const adj = { checkIn: pkt("2026-10-09 16:00:00"), checkOut: pkt("2026-10-10 00:00:00") };
    const day = computeDay(d, applyAdjustment([], adj), FRIDAY, false)!;
    expect(excuseAdjusted(day, adj, FRIDAY)).toMatchObject({ status: "PRESENT", lateMinutes: 0 });
  });

  it("no times edited: the whole day is present", () => {
    const adj = { checkIn: null, checkOut: null };
    const day = computeDay(d, applyAdjustment(machine, adj), FRIDAY, false)!;
    expect(excuseAdjusted(day, adj, FRIDAY).status).toBe("PRESENT");
  });
});

describe("grace period uses the minute shown on the clock", () => {
  it("2:15:40 PM is on time with 15 minutes' grace; 2:16:00 is late", () => {
    const out = pkt("2026-10-08 23:25:00");
    expect(computeDay("2026-10-08", [pkt("2026-10-08 14:15:40"), out], SHIFT, false)).toMatchObject({ status: "PRESENT", lateMinutes: 15 });
    expect(computeDay("2026-10-08", [pkt("2026-10-08 14:16:00"), out], SHIFT, false)).toMatchObject({ status: "LATE", lateMinutes: 16 });
  });
});
