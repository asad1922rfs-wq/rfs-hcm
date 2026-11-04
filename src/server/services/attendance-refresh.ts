import "server-only";
import { after } from "next/server";
import { pruneBeforeAttendanceStart, recomputeAttendance } from "@/server/services/attendance";
import { addDaysIso } from "@/core/attendance/engine";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

/**
 * Keep attendance fresh without waiting for a punch (e.g. after a manual fix, an interrupted sync or a rule change):
 * triggered by the sync agent heartbeat or the direct machine poll; every 10 minutes for today and yesterday, and once after each start for last month onwards.
 */
const REFRESH_EVERY_MS = 10 * 60_000;
let lastRefresh = 0;

export function refreshRecentAttendance() {
  if (Date.now() - lastRefresh < REFRESH_EVERY_MS) return;
  const firstSinceStart = lastRefresh === 0;
  lastRefresh = Date.now();
  const today = toDateOnlyString(todayInPKT());
  // After a deploy or restart, recalculate from the start of last month so changed rules apply to open months too.
  const from = firstSinceStart ? `${addMonthsIso(today.slice(0, 7), -1)}-01` : addDaysIso(today, -1);
  after(async () => {
    try {
      if (firstSinceStart) await pruneBeforeAttendanceStart();
      await recomputeAttendance({ from, to: today });
    } catch (err) {
      console.error("attendance refresh failed", err);
    }
  });
}

/** "YYYY-MM" shifted by n months. */
function addMonthsIso(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

