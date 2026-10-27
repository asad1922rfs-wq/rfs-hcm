// Sign in / out from the web for remote (work from home) employees. Pure rules, shared by the service and tests.

/** A web punch within this long of the previous punch is refused (double clicks, retries). */
export const WEB_PUNCH_MIN_GAP_MS = 2 * 60_000;

export const WORK_MODES = ["OFFICE", "REMOTE"] as const;
export type WorkModeValue = (typeof WORK_MODES)[number];

export const WORK_MODE_LABELS: Record<WorkModeValue, string> = {
  OFFICE: "Office",
  REMOTE: "Remote (work from home)",
};

/** Why this employee may not record a web punch now, or null when they may. */
export function webPunchBlockReason(
  employee: { workMode: string; status: string },
  lastPunchAt: Date | null,
  now: Date,
): string | null {
  if (employee.workMode !== "REMOTE") return "Only remote employees can sign in from the web.";
  if (employee.status !== "ACTIVE") return "Your employee record is not active.";
  if (lastPunchAt && now.getTime() - lastPunchAt.getTime() < WEB_PUNCH_MIN_GAP_MS) {
    return "You just recorded a punch — wait a couple of minutes and try again.";
  }
  return null;
}

/** The biometric user ID a web punch is stored under (the employee's own, so machine and web punches line up). */
export function webPunchDeviceUserId(employee: { id: string; deviceUserId: string | null }): string {
  return employee.deviceUserId ?? `web-${employee.id}`;
}

/** "YYYY-MM-DD HH:mm:ss" in Pakistan time (UTC+5, no DST) — the same shape the device sends. */
export function pktLocalString(at: Date): string {
  return new Date(at.getTime() + 5 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}
