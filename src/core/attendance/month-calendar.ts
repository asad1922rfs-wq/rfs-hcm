// Builds the per-day view of one employee's month from attendance records and the company calendar.
// Days without a processed attendance record are never assumed absent: past working days without a record
// are NOT_SYNCED until the attendance engine has produced a result for them.

import type { DayStatus } from "./day-status";

export type DayRecord = { status: DayStatus; workedMinutes: number | null; signIn?: string | null; signOut?: string | null };

export type CalendarDay = {
  date: string; // YYYY-MM-DD
  day: number;
  weekday: number; // 0 = Sunday
  status: DayStatus | null; // null = not employed on this date
  workedMinutes: number | null;
  /** Display labels in Pakistan time, e.g. "2:05 PM" or "12:30 AM (next day)" */
  signIn: string | null;
  signOut: string | null;
};

export type MonthCalendarInput = {
  year: number;
  month: number; // 1–12
  today: string; // YYYY-MM-DD in company timezone
  weekendDays: readonly number[];
  joiningDate: string;
  exitDate?: string | null;
  records: ReadonlyMap<string, DayRecord>;
};

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function buildMonthCalendar(input: MonthCalendarInput): CalendarDay[] {
  const daysInMonth = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const days: CalendarDay[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(input.year, input.month, d);
    const weekday = new Date(Date.UTC(input.year, input.month - 1, d)).getUTCDay();
    const base = { date, day: d, weekday };

    if (date < input.joiningDate || (input.exitDate && date > input.exitDate)) {
      days.push({ ...base, status: null, workedMinutes: null, signIn: null, signOut: null });
      continue;
    }
    const record = input.records.get(date);
    if (record) {
      days.push({ ...base, status: record.status, workedMinutes: record.workedMinutes, signIn: record.signIn ?? null, signOut: record.signOut ?? null });
    } else if (input.weekendDays.includes(weekday)) {
      days.push({ ...base, status: "OFF", workedMinutes: null, signIn: null, signOut: null });
    } else if (date >= input.today) {
      days.push({ ...base, status: "SCHEDULED", workedMinutes: null, signIn: null, signOut: null });
    } else {
      days.push({ ...base, status: "NOT_SYNCED", workedMinutes: null, signIn: null, signOut: null });
    }
  }
  return days;
}

export type MonthSummary = {
  present: number;
  late: number;
  early: number;
  halfDay: number;
  absent: number;
  leave: number;
  offDays: number;
  missing: number;
  notSynced: number;
  workedMinutes: number;
};

/** Counts for days up to and including today (future days are excluded, like the FlowHCM summary). */
export function summariseMonth(days: readonly CalendarDay[], today: string): MonthSummary {
  const s: MonthSummary = { present: 0, late: 0, early: 0, halfDay: 0, absent: 0, leave: 0, offDays: 0, missing: 0, notSynced: 0, workedMinutes: 0 };
  for (const day of days) {
    if (day.date > today || !day.status) continue;
    s.workedMinutes += day.workedMinutes ?? 0;
    switch (day.status) {
      case "PRESENT":
      case "SHORT_DAY":
      case "ABSENT_SHORT_TIME":
        s.present++;
        break;
      case "LATE":
        s.present++;
        s.late++;
        break;
      case "EARLY":
        s.present++;
        s.early++;
        break;
      case "HALF_DAY":
        s.halfDay++;
        break;
      case "ABSENT":
        s.absent++;
        break;
      case "LEAVE":
        s.leave++;
        break;
      case "OFF":
        s.offDays++;
        break;
      case "MISSING":
        s.missing++;
        break;
      case "NOT_SYNCED":
        s.notSynced++;
        break;
      case "SCHEDULED":
        break;
    }
  }
  return s;
}

/** 545 → "9:05" */
export function formatHoursMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;
}
