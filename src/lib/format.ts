// Formatting helpers for PKR and Pakistan Standard Time. Safe to use on client and server.

export const APP_TIMEZONE = "Asia/Karachi";

const pkr = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", maximumFractionDigits: 0 });
const pkrExact = new Intl.NumberFormat("en-PK", { style: "currency", currency: "PKR", minimumFractionDigits: 2 });

type Numeric = number | string | { toString(): string };

export function formatPKR(value: Numeric, exact = false): string {
  const n = typeof value === "number" ? value : Number(value.toString());
  return (exact ? pkrExact : pkr).format(n);
}

/** Format a calendar date stored as @db.Date (UTC midnight) without shifting it into another day. */
export function formatDate(value: Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(value);
}

/** Format an instant in Pakistan time. */
export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: APP_TIMEZONE,
  }).format(value);
}

/** Minutes after midnight → "2:00 PM". */
export function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "15:10" → "3:10 PM" (passes through anything that isn't HH:MM). */
export function to12h(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? formatMinuteOfDay(Number(m[1]) * 60 + Number(m[2])) : hhmm;
}

/** "14:30" → 870 */
export function parseTimeOfDay(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time "${value}"`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new Error(`Invalid time "${value}"`);
  return h * 60 + m;
}

export function minuteToTimeInput(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
