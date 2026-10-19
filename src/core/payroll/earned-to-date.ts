// "Earned till today": what an employee has earned so far in an unfinished month. Pure.
//
//   per-day rate × days employed from the month start (or joining date) through today
//   − the attendance deductions already incurred (absent, unpaid leave, late / missing punch).
//
// Loan installments and manual adjustments apply at month end, and the "not employed" proration is already
// excluded by starting at the joining date, so none of those are subtracted here.

import type { PayLine } from "@/core/payroll/calculate";

/** Deduction codes that are not attendance incurred so far. */
const NOT_SO_FAR = new Set(["LOAN", "ADJ_DEDUCTION", "PRORATION", "NOT_EMPLOYED"]);

export type EarnedToDate = { from: string; to: string; days: number; amount: number };

export function earnedToDate(input: {
  year: number;
  month: number; // 1–12
  today: string; // YYYY-MM-DD (Pakistan time)
  joiningDate: string;
  exitDate: string | null;
  perDayRate: number;
  lines: readonly PayLine[];
}): EarnedToDate | null {
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const monthStart = `${input.year}-${pad(input.month)}-01`;
  const monthEnd = `${input.year}-${pad(input.month)}-${pad(daysInMonth)}`;
  // Only meaningful while the month is under way.
  if (input.today < monthStart || input.today > monthEnd) return null;

  const from = input.joiningDate > monthStart ? input.joiningDate : monthStart;
  let to = input.today;
  if (input.exitDate && input.exitDate < to) to = input.exitDate;
  const days = to < from ? 0 : Number(to.slice(8, 10)) - Number(from.slice(8, 10)) + 1;

  const incurred = input.lines.filter((l) => l.kind === "DEDUCTION" && !NOT_SO_FAR.has(l.code)).reduce((s, l) => s + l.amount, 0);
  return { from, to, days, amount: Math.max(0, Math.round(days * input.perDayRate - incurred)) };
}
