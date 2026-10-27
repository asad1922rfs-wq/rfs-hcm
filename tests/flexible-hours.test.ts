import { describe, expect, it } from "vitest";
import { computeFlexibleDay, flexibleWorkDateOf, FLEXIBLE_MIN_WORK_MINUTES, groupFlexiblePunches, instantAt } from "@/core/attendance/engine";

// Local (PKT) time on a date; minutes ≥ 1440 fall on the next day.
const at = (date: string, h: number, m = 0) => instantAt(date, h * 60 + m);

describe("flexible hours (remote)", () => {
  it("is never late or early, whatever the sign-in time", () => {
    const r = computeFlexibleDay([at("2026-11-02", 16, 30), at("2026-11-03", 1, 45)], true);
    expect(r).toMatchObject({ status: "PRESENT", lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 555 });
  });
  it("marks a short day under 9 hours", () => {
    const r = computeFlexibleDay([at("2026-11-02", 10), at("2026-11-02", 17, 10)], true);
    expect(r).toMatchObject({ status: "SHORT_DAY", workedMinutes: 430, lateMinutes: 0 });
  });
  it("is present at exactly 9 hours or more", () => {
    expect(computeFlexibleDay([at("2026-11-02", 9), at("2026-11-02", 18)], true)?.status).toBe("PRESENT");
    expect(FLEXIBLE_MIN_WORK_MINUTES).toBe(540);
  });
  it("only a sign-in is missing once the day is over, present while in progress", () => {
    expect(computeFlexibleDay([at("2026-11-02", 9)], true)?.status).toBe("MISSING");
    expect(computeFlexibleDay([at("2026-11-02", 9)], true, true)?.status).toBe("PRESENT");
  });
  it("credits any punches as present before flexible hours start", () => {
    expect(computeFlexibleDay([at("2026-10-20", 12), at("2026-10-20", 14)], false)?.status).toBe("PRESENT");
    expect(computeFlexibleDay([at("2026-10-20", 12)], false)?.status).toBe("PRESENT");
    expect(computeFlexibleDay([], false)).toBeNull();
  });
});

describe("flexible work-date grouping", () => {
  it("keeps a sign-out after midnight on the sign-in's date (2 PM → 1 AM, 10 PM → 7 AM)", () => {
    const groups = groupFlexiblePunches([at("2026-11-02", 14), at("2026-11-02", 25), at("2026-11-03", 22), at("2026-11-03", 31)]);
    expect([...groups.keys()]).toEqual(["2026-11-02", "2026-11-03"]);
    expect(groups.get("2026-11-02")).toHaveLength(2);
    expect(groups.get("2026-11-03")).toHaveLength(2);
  });
  it("a punch more than 20 hours after the sign-in opens a new day", () => {
    const groups = groupFlexiblePunches([at("2026-11-02", 9), at("2026-11-02", 18), at("2026-11-03", 8)]);
    expect(groups.get("2026-11-02")).toHaveLength(2);
    expect(groups.get("2026-11-03")).toHaveLength(1);
  });
  it("places a single instant by the other punches", () => {
    expect(flexibleWorkDateOf(at("2026-11-03", 6), [at("2026-11-02", 22)])).toBe("2026-11-02");
    expect(flexibleWorkDateOf(at("2026-11-03", 19), [at("2026-11-02", 22)])).toBe("2026-11-03");
  });
});
