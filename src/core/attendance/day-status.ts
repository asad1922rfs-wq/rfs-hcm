// Attendance day statuses shown on calendars, charts and summaries.
// Pure module: safe to import from client and server code.

export const DAY_STATUSES = {
  PRESENT: { label: "Present", color: "var(--status-present)" },
  LATE: { label: "Late", color: "var(--status-late)" },
  EARLY: { label: "Early", color: "var(--status-early)" },
  HALF_DAY: { label: "Half day", color: "var(--status-halfday)" },
  ABSENT: { label: "Absent", color: "var(--status-absent)" },
  SHORT_DAY: { label: "Short day", color: "var(--status-short)" },
  ABSENT_SHORT_TIME: { label: "Absent for short time", color: "var(--status-absent-short)" },
  LEAVE: { label: "Leave", color: "var(--status-leave)" },
  SCHEDULED: { label: "Scheduled", color: "var(--status-scheduled)" },
  MISSING: { label: "Missing punch", color: "var(--status-missing)" },
  OFF: { label: "Off", color: "var(--status-off)" },
  NOT_SYNCED: { label: "Not synced", color: "var(--status-not-synced)" },
} as const;

export type DayStatus = keyof typeof DAY_STATUSES;

/** Statuses where the employee worked; their bar height is the worked time. */
export const WORKED_STATUSES: readonly DayStatus[] = ["PRESENT", "LATE", "EARLY", "HALF_DAY", "SHORT_DAY", "ABSENT_SHORT_TIME", "MISSING"];
