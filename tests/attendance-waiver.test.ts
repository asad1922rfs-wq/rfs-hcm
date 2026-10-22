import { describe, expect, it } from "vitest";
import { computeDay, instantAt } from "@/core/attendance/engine";
import { applyLateWaiver, checkWaiverHours, MONTHLY_WAIVER_LIMIT, requiredShiftMinutes, waiverReasonText, waiverRequestsLeft } from "@/core/attendance/waiver";

const SHIFT = { startMinute: 14 * 60, endMinute: 23 * 60, graceMinutes: 15 }; // 2 PM – 11 PM

describe("required shift minutes", () => {
  it("is the shift length, including shifts past midnight", () => {
    expect(requiredShiftMinutes(SHIFT)).toBe(540);
    expect(requiredShiftMinutes({ startMinute: 15 * 60, endMinute: 0 })).toBe(540); // 3 PM – 12 AM
    expect(requiredShiftMinutes({ startMinute: 22 * 60, endMinute: 6 * 60 })).toBe(480);
  });
});

describe("waiver hours check", () => {
  it("approves a late day with the full shift worked", () => {
    expect(checkWaiverHours({ status: "LATE", workedMinutes: 540 }, 540)).toEqual({ ok: true, workedMinutes: 540 });
    expect(checkWaiverHours({ status: "LATE", workedMinutes: 600 }, 540).ok).toBe(true);
  });

  it("blocks short days with the worked / required times", () => {
    const r = checkWaiverHours({ status: "LATE", workedMinutes: 490 }, 540);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Only 8:10 worked of 9:00 — can't waive the late. Reject, or correct the times first.");
  });

  it("blocks a missing punch or no attendance until the times are fixed", () => {
    const missing = checkWaiverHours({ status: "MISSING", workedMinutes: null }, 540);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toMatch(/fix the times/);
    expect(checkWaiverHours(null, 540).ok).toBe(false);
  });

  it("blocks a day that is not late", () => {
    expect(checkWaiverHours({ status: "PRESENT", workedMinutes: 560 }, 540).ok).toBe(false);
  });
});

describe("monthly limit", () => {
  const rows = (n: number, status: string, month = "2026-10") => Array.from({ length: n }, (_, i) => ({ workDate: `${month}-${String(i + 1).padStart(2, "0")}`, status }));

  it("counts pending and approved in that month only", () => {
    expect(waiverRequestsLeft([], "2026-10")).toBe(MONTHLY_WAIVER_LIMIT);
    expect(waiverRequestsLeft([...rows(1, "PENDING"), ...rows(1, "APPROVED")], "2026-10")).toBe(3);
    expect(waiverRequestsLeft([...rows(4, "REJECTED"), ...rows(3, "CANCELLED")], "2026-10")).toBe(5);
    expect(waiverRequestsLeft(rows(5, "APPROVED", "2026-09"), "2026-10")).toBe(5);
    expect(waiverRequestsLeft(rows(7, "PENDING"), "2026-10")).toBe(0);
  });
});

describe("late waiver in recalculation", () => {
  const date = "2026-10-21";
  // In 2:40 PM (late), out 11:45 PM: 9:05 worked.
  const late = computeDay(date, [instantAt(date, 14 * 60 + 40), instantAt(date, 23 * 60 + 45)], SHIFT, false)!;

  it("turns Late into Present only when approved, keeping the late minutes", () => {
    expect(late.status).toBe("LATE");
    expect(applyLateWaiver(late, false)).toEqual(late);
    const waived = applyLateWaiver(late, true);
    expect(waived.status).toBe("PRESENT");
    expect(waived.lateMinutes).toBe(40);
  });

  it("does not touch other statuses", () => {
    const missing = computeDay(date, [instantAt(date, 14 * 60 + 40)], SHIFT, false)!;
    expect(applyLateWaiver(missing, true).status).toBe("MISSING");
    const early = { ...late, status: "EARLY" as const };
    expect(applyLateWaiver(early, true).status).toBe("EARLY");
  });

  it("knows the reason texts", () => {
    expect(waiverReasonText("MACHINE_ISSUE")).toBe("Forgot to punch / machine issue");
    expect(waiverReasonText("nope")).toBeNull();
  });
});
