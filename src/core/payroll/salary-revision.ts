// Rules for changing salary history and sales months once payroll has been approved. Pure.
// Approved / paid payslips are frozen snapshots, but history must stay consistent with them, so a revision (or a
// sales month) that falls in a month with approved or paid payroll cannot be changed.

/** "YYYY-MM" of a "YYYY-MM-DD" date. */
export const monthKey = (date: string) => date.slice(0, 7);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** Why a month's sales row cannot be changed, or null when it can. `lockedMonths` holds "YYYY-MM" of approved/paid payroll. */
export function salesMonthBlock(ym: string, lockedMonths: ReadonlySet<string>): string | null {
  return lockedMonths.has(ym)
    ? `Payroll for ${monthLabel(ym)} is approved or paid, so its sales figures and commission can no longer be changed.`
    : null;
}

/**
 * Why a salary revision cannot be edited (newDate given) or deleted (newDate null), or null when it can.
 * `otherDates` are the effective dates of the employee's other revisions.
 */
export function salaryRevisionBlock(input: {
  currentDate: string;
  newDate: string | null;
  otherDates: readonly string[];
  lockedMonths: ReadonlySet<string>;
}): string | null {
  const action = input.newDate === null ? "deleted" : "changed";
  if (input.lockedMonths.has(monthKey(input.currentDate))) {
    return `Payroll for ${monthLabel(monthKey(input.currentDate))} is approved or paid, so a revision effective in that month can no longer be ${action}. Add a new revision instead.`;
  }
  if (input.newDate !== null) {
    if (input.lockedMonths.has(monthKey(input.newDate))) {
      return `Payroll for ${monthLabel(monthKey(input.newDate))} is approved or paid, so a revision cannot be moved into that month.`;
    }
    if (input.otherDates.includes(input.newDate)) return "Another salary revision already starts on that date.";
  }
  return null;
}
