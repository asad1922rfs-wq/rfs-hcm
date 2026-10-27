// Short, readable payslip labels from pay lines (src/core/payroll/calculate.ts). Pure.
// The day counts are read back from the engine's own labels, so payslips of past runs get them too.

import type { PayLine } from "@/core/payroll/calculate";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const firstNumber = (s: string) => {
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) : null;
};

export function payslipLineLabel(line: Pick<PayLine, "code" | "label">): string {
  switch (line.code) {
    case "BASIC":
      return "Basic Salary";
    case "ABSENT": {
      const n = firstNumber(line.label);
      return n === null ? "Absent Deduction" : `Absent Deduction (${n.toFixed(2)} Absent Days)`;
    }
    case "UNPAID_LEAVE": {
      const n = firstNumber(line.label);
      return n === null ? "Unpaid Leave" : `Unpaid Leave (${plural(n, "day")})`;
    }
    case "HALF_DAY": {
      // "Half day 2 × 0.5 × 3225.81"
      const n = firstNumber(line.label);
      return n === null ? "Half Day Deduction" : `Half Day Deduction (${plural(n, "day")})`;
    }
    case "LATE": {
      // "2 late arrivals + 1 missing punch → 1 day (every 3 = 1 day) × 3225.81"
      const m = /→\s*(\d+)\s*day/.exec(line.label);
      return m ? `Late / Missing Punch (${plural(Number(m[1]), "day")})` : "Late / Missing Punch";
    }
    case "LOAN": {
      const m = /installment (\d+) of (\d+)/i.exec(line.label);
      const reduced = /reduced/i.test(line.label) ? ", reduced" : "";
      // Older lines say "installment N of M"; loans no longer have a fixed number of installments.
      return m ? `Loan (Installment ${m[1]} of ${m[2]}${reduced})` : reduced ? "Loan (reduced)" : "Loan";
    }
    case "PRORATION":
    case "NOT_EMPLOYED": {
      // "Not employed 5 days (joined 2026-10-06) × 3225.81"
      const n = firstNumber(line.label);
      const reason = /\(([^)]*)\)/.exec(line.label)?.[1];
      return n === null ? "Not Employed" : `Not Employed (${plural(n, "day")}${reason ? `, ${reason}` : ""})`;
    }
    default:
      return line.label;
  }
}
