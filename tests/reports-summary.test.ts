import { describe, expect, it } from "vitest";
import type { AttendanceStatusCode } from "@/core/payroll/calculate";
import { hoursMinutes, monthRange, summariseAttendance, type SummaryDay } from "@/core/reports/attendance-summary";

const day = (d: number, status: AttendanceStatusCode, workedMinutes: number | null = 540, lateMinutes = 0): SummaryDay => ({
  workDate: `2026-10-${String(d).padStart(2, "0")}`, status, workedMinutes, lateMinutes,
});
const { from, to } = monthRange(2026, 10);

describe("summariseAttendance", () => {
  it("counts each status and treats every attended day as present", () => {
    const s = summariseAttendance(
      [
        day(1, "PRESENT"), day(2, "LATE", 500, 25), day(5, "EARLY", 420), day(6, "MISSING", null), day(7, "HALF_DAY", 240),
        day(8, "SHORT_DAY", 300), day(9, "ABSENT", null), day(12, "LEAVE", null),
      ],
      from, to,
    );
    expect(s).toMatchObject({ present: 6, onTime: 1, late: 1, early: 1, missing: 1, halfOrShort: 2, absent: 1, leave: 1 });
    expect(s.workedMinutes).toBe(540 + 500 + 420 + 240 + 300);
    expect(s.lateMinutes).toBe(25);
  });

  it("deducts one day for every 3 late arrivals and missing punches together", () => {
    const two = summariseAttendance([day(1, "LATE"), day(2, "MISSING")], from, to);
    expect(two).toMatchObject({ lateAndMissing: 2, lateDeductionDays: 0 });

    const three = summariseAttendance([day(1, "LATE"), day(2, "LATE"), day(3, "MISSING")], from, to);
    expect(three).toMatchObject({ lateAndMissing: 3, lateDeductionDays: 1 });

    const seven = summariseAttendance([1, 2, 5, 6].map((d) => day(d, "LATE")).concat([7, 8, 9].map((d) => day(d, "MISSING"))), from, to);
    expect(seven).toMatchObject({ late: 4, missing: 3, lateAndMissing: 7, lateDeductionDays: 2 });
  });

  it("does not count early, half or short days towards the late rule", () => {
    const s = summariseAttendance([day(1, "EARLY"), day(2, "HALF_DAY"), day(5, "SHORT_DAY"), day(6, "ABSENT")], from, to);
    expect(s).toMatchObject({ lateAndMissing: 0, lateDeductionDays: 0 });
  });

  it("ignores days outside the month", () => {
    const s = summariseAttendance(
      [{ ...day(1, "LATE"), workDate: "2026-09-30" }, day(1, "LATE"), day(31, "LATE"), { ...day(1, "LATE"), workDate: "2026-11-01" }],
      from, to,
    );
    expect(s.late).toBe(2);
    expect(s.lateDeductionDays).toBe(0);
  });

  it("returns zeros for an empty month", () => {
    expect(summariseAttendance([], from, to)).toMatchObject({ present: 0, workedMinutes: 0, lateDeductionDays: 0 });
  });
});

describe("helpers", () => {
  it("monthRange covers the whole calendar month", () => {
    expect(monthRange(2026, 2)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange(2028, 2)).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange(2026, 12)).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("hoursMinutes formats h:mm", () => {
    expect(hoursMinutes(545)).toBe("9:05");
    expect(hoursMinutes(0)).toBe("0:00");
    expect(hoursMinutes(null)).toBe("");
  });

  it("total deduction days = absent days + one day per 3 lates/missing", () => {
    const days = [
      { workDate: "2026-10-01", status: "ABSENT", workedMinutes: null, lateMinutes: 0 },
      { workDate: "2026-10-02", status: "ABSENT", workedMinutes: null, lateMinutes: 0 },
      { workDate: "2026-10-05", status: "LATE", workedMinutes: 500, lateMinutes: 20 },
      { workDate: "2026-10-06", status: "LATE", workedMinutes: 500, lateMinutes: 20 },
      { workDate: "2026-10-07", status: "MISSING", workedMinutes: null, lateMinutes: 0 },
    ] as const;
    expect(summariseAttendance(days, "2026-10-01", "2026-10-31")).toMatchObject({ absent: 2, lateDeductionDays: 1, totalDeductionDays: 3 });
  });
});
