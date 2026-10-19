import { describe, expect, it } from "vitest";
import { buildMonthCalendar, formatHoursMinutes, summariseMonth, type DayRecord } from "@/core/attendance/month-calendar";

const base = { year: 2026, month: 10, today: "2026-10-16", weekendDays: [0, 6], joiningDate: "2023-11-01", records: new Map<string, DayRecord>() };

describe("buildMonthCalendar", () => {
  it("covers every day of the month", () => {
    expect(buildMonthCalendar(base)).toHaveLength(31);
  });

  it("marks Sat/Sun off, past weekdays without data as not synced (never absent), and future days as scheduled", () => {
    const days = buildMonthCalendar(base);
    const byDate = (d: string) => days.find((x) => x.date === d)!.status;
    expect(byDate("2026-10-03")).toBe("OFF"); // Saturday
    expect(byDate("2026-10-04")).toBe("OFF"); // Sunday
    expect(byDate("2026-10-01")).toBe("NOT_SYNCED");
    expect(byDate("2026-10-16")).toBe("SCHEDULED"); // today, shift not finished
    expect(byDate("2026-10-20")).toBe("SCHEDULED");
    expect(days.some((d) => d.status === "ABSENT")).toBe(false);
  });

  it("uses attendance records when present, even on weekends", () => {
    const records = new Map<string, DayRecord>([
      ["2026-10-01", { status: "PRESENT", workedMinutes: 540 }],
      ["2026-10-03", { status: "PRESENT", workedMinutes: 300 }],
    ]);
    const days = buildMonthCalendar({ ...base, records });
    expect(days[0]).toMatchObject({ status: "PRESENT", workedMinutes: 540 });
    expect(days[2]).toMatchObject({ status: "PRESENT", workedMinutes: 300 });
  });

  it("leaves days before joining and after exit empty", () => {
    const days = buildMonthCalendar({ ...base, joiningDate: "2026-10-12", exitDate: "2026-10-14" });
    expect(days[10]!.status).toBeNull();
    expect(days[11]!.status).toBe("NOT_SYNCED");
    expect(days[14]!.status).toBeNull();
  });
});

describe("summariseMonth", () => {
  it("counts only elapsed days", () => {
    const records = new Map<string, DayRecord>([
      ["2026-10-01", { status: "PRESENT", workedMinutes: 540 }],
      ["2026-10-02", { status: "LATE", workedMinutes: 500 }],
      ["2026-10-05", { status: "ABSENT", workedMinutes: null }],
    ]);
    const s = summariseMonth(buildMonthCalendar({ ...base, records }), base.today);
    expect(s).toMatchObject({ present: 2, late: 1, absent: 1, offDays: 4, workedMinutes: 1040 });
    expect(s.notSynced).toBe(8); // 12 weekdays before 16 Oct minus 3 with records... minus today
  });
});

describe("formatHoursMinutes", () => {
  it("formats", () => {
    expect(formatHoursMinutes(545)).toBe("9:05");
    expect(formatHoursMinutes(0)).toBe("0:00");
  });
});

describe("buildMonthCalendar with public holidays", () => {
  it("shows a holiday as OFF with its name, past or future", () => {
    const holidays = new Map([["2026-10-07", "Test Day"], ["2026-10-21", "Later Day"]]);
    const days = buildMonthCalendar({ ...base, holidays });
    const day = (d: string) => days.find((x) => x.date === d)!;
    expect(day("2026-10-07")).toMatchObject({ status: "OFF", holiday: "Test Day" });
    expect(day("2026-10-21")).toMatchObject({ status: "OFF", holiday: "Later Day" });
    expect(day("2026-10-08").status).toBe("NOT_SYNCED");
    expect(summariseMonth(days, base.today).notSynced).toBe(10); // 11 past weekdays, one of them the holiday
  });
});
