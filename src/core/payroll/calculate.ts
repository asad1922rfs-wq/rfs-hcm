// Monthly pay calculation for RFS. Pure: no I/O, deterministic, fully explained line by line.
//
// Confirmed RFS rules (docs/ARCHITECTURE.md §0):
//   * Payroll month = calendar month. Per-day rate = monthly gross ÷ days in that month.
//   * Each ABSENT day deducts one day.
//   * Late arrivals and missing punches together: every 3 deduct one day.
//   * Overtime is not paid. No income tax yet.
// Defaults applied where RFS gave no rule (flagged in the summary to HR):
//   * Joiners/leavers are paid only for the calendar days they were employed in the month.
//   * Days with no machine record are NOT deducted — they are reported as warnings for HR to check.
//   * Money lines are rounded to whole rupees.

export type AttendanceStatusCode = "PRESENT" | "LATE" | "EARLY" | "HALF_DAY" | "SHORT_DAY" | "ABSENT" | "LEAVE" | "MISSING";

export type PayLine = { kind: "EARNING" | "DEDUCTION"; code: string; label: string; amount: number };

export type PayInput = {
  year: number;
  month: number; // 1–12
  today: string; // YYYY-MM-DD (Pakistan time)
  joiningDate: string;
  exitDate: string | null;
  weekendDays: readonly number[];
  salary: { basic: number; allowances: readonly { name: string; amount: number }[] } | null;
  /** Attendance status per work date (only dates that have a processed record). */
  days: ReadonlyMap<string, AttendanceStatusCode>;
  adjustments: readonly { kind: "EARNING" | "DEDUCTION"; label: string; amount: number }[];
};

export type PayResult = {
  daysInMonth: number;
  employedDays: number;
  gross: number;
  perDayRate: number;
  presentDays: number;
  absentDays: number;
  lateCount: number;
  missingPunchCount: number;
  lateDeductionDays: number;
  notSyncedDays: number;
  remainingDays: number;
  lines: PayLine[];
  earnings: number;
  deductions: number;
  netPay: number;
  warnings: string[];
};

export const LATES_PER_DEDUCTION_DAY = 3;

const rupees = (n: number) => Math.round(n);
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function calculatePay(input: PayInput): PayResult {
  const warnings: string[] = [];
  const daysInMonth = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const monthStart = iso(input.year, input.month, 1);
  const monthEnd = iso(input.year, input.month, daysInMonth);
  const from = input.joiningDate > monthStart ? input.joiningDate : monthStart;
  const to = input.exitDate && input.exitDate < monthEnd ? input.exitDate : monthEnd;

  const basic = input.salary?.basic ?? 0;
  const allowances = input.salary?.allowances ?? [];
  const gross = basic + allowances.reduce((s, a) => s + a.amount, 0);
  if (!input.salary) warnings.push("No salary is set for this employee — pay is zero until a salary is added");
  const perDayRate = Math.round((gross / daysInMonth) * 100) / 100;

  let employedDays = 0, presentDays = 0, absentDays = 0, lateCount = 0, missingPunchCount = 0, notSyncedDays = 0, remainingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(input.year, input.month, d);
    if (date < from || date > to) continue;
    employedDays++;
    const status = input.days.get(date);
    if (date >= input.today && !status) {
      remainingDays++;
      continue;
    }
    switch (status) {
      case "ABSENT":
        absentDays++;
        break;
      case "LATE":
        lateCount++;
        presentDays++;
        break;
      case "MISSING":
        missingPunchCount++;
        presentDays++;
        break;
      case "PRESENT":
      case "EARLY":
      case "HALF_DAY":
      case "SHORT_DAY":
        presentDays++;
        break;
      case "LEAVE":
        break;
      case undefined: {
        const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (!input.weekendDays.includes(weekday)) notSyncedDays++;
      }
    }
  }

  const lines: PayLine[] = [];
  if (gross > 0) {
    lines.push({ kind: "EARNING", code: "BASIC", label: "Basic salary", amount: rupees(basic) });
    for (const a of allowances) if (a.amount > 0) lines.push({ kind: "EARNING", code: "ALLOWANCE", label: `${a.name} allowance`, amount: rupees(a.amount) });
  }

  if (employedDays === 0) {
    warnings.push("Not employed in this month");
  } else if (employedDays < daysInMonth && gross > 0) {
    const notEmployed = daysInMonth - employedDays;
    const reason = input.joiningDate > monthStart && input.exitDate && input.exitDate < monthEnd ? "joined and left this month" : input.joiningDate > monthStart ? `joined ${input.joiningDate}` : `left ${input.exitDate}`;
    lines.push({ kind: "DEDUCTION", code: "PRORATION", label: `Not employed ${plural(notEmployed, "day")} (${reason}) × ${perDayRate.toFixed(2)}`, amount: rupees(notEmployed * perDayRate) });
  }

  if (absentDays > 0 && gross > 0) {
    lines.push({ kind: "DEDUCTION", code: "ABSENT", label: `Absent ${plural(absentDays, "day")} × ${perDayRate.toFixed(2)}`, amount: rupees(absentDays * perDayRate) });
  }

  const lateDeductionDays = Math.floor((lateCount + missingPunchCount) / LATES_PER_DEDUCTION_DAY);
  if (lateDeductionDays > 0 && gross > 0) {
    const missing = missingPunchCount === 1 ? "1 missing punch" : `${missingPunchCount} missing punches`;
    const parts = [lateCount ? plural(lateCount, "late arrival") : "", missingPunchCount ? missing : ""].filter(Boolean).join(" + ");
    lines.push({
      kind: "DEDUCTION",
      code: "LATE",
      label: `${parts} → ${plural(lateDeductionDays, "day")} (every ${LATES_PER_DEDUCTION_DAY} = 1 day) × ${perDayRate.toFixed(2)}`,
      amount: rupees(lateDeductionDays * perDayRate),
    });
  }

  for (const a of input.adjustments) {
    if (a.amount <= 0) continue;
    lines.push({ kind: a.kind, code: a.kind === "EARNING" ? "ADJ_EARNING" : "ADJ_DEDUCTION", label: a.label, amount: rupees(a.amount) });
  }

  const earnings = lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + l.amount, 0);
  const deductions = lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + l.amount, 0);
  let netPay = earnings - deductions;
  if (netPay < 0) {
    warnings.push(`Deductions exceed earnings by ${-netPay} — net pay set to 0`);
    netPay = 0;
  }

  if (notSyncedDays > 0) warnings.push(`${plural(notSyncedDays, "working day")} without machine attendance — not deducted; check before approving`);
  if (remainingDays > 0) warnings.push(`Month not finished: ${plural(remainingDays, "day")} still to come are counted as paid`);

  return {
    daysInMonth, employedDays, gross, perDayRate, presentDays, absentDays, lateCount, missingPunchCount, lateDeductionDays,
    notSyncedDays, remainingDays, lines, earnings, deductions, netPay, warnings,
  };
}
