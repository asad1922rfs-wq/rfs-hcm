// Parses the salary upload sheet. Pure: header + rows of cell text.
//   Required columns: "Employee Code", "Basic Salary"
//   Optional: "Effective From" (defaults to the joining date when the employee has no salary yet)
//   Allowances: any column titled "Allowance: <name>" (e.g. "Allowance: Fuel"); empty or 0 = not paid.

import { parseFlexibleDate } from "@/core/employees/flowhcm-import";

export type SalaryImportRow = {
  rowNumber: number;
  employeeCode: string;
  basicSalary: number | null;
  effectiveFrom: string | null;
  allowances: { name: string; amount: number }[];
  errors: string[];
  warnings: string[];
};

const MAX_AMOUNT = 100_000_000;

/** "80,000", "PKR 80000", "Rs. 80,000.50" → 80000.5; "" → null; anything else → NaN */
export function parseAmount(v: string): number | null {
  const s = v.replace(/(pkr|rs\.?)/gi, "").replace(/[,\s]/g, "").trim();
  if (s === "" || s === "-" || s === "--") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  return Number(s);
}

export function parseSalaryRows(header: string[], rows: string[][], today: Date = new Date()): SalaryImportRow[] {
  const norm = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, " "));
  const codeCol = norm.findIndex((h) => h === "employee code" || h === "employeecode" || h === "employee id");
  const basicCol = norm.findIndex((h) => h === "basic salary" || h === "basic" || h === "basicsalary");
  const effCol = norm.findIndex((h) => h === "effective from" || h === "effectivefrom" || h === "effective date");
  const allowanceCols = header
    .map((h, i) => ({ i, m: /^\s*allowance\s*:\s*(.+?)\s*$/i.exec(h) }))
    .filter((x) => x.m)
    .map((x) => ({ i: x.i, name: x.m![1]!.replace(/\s+/g, " ") }));
  if (codeCol < 0 || basicCol < 0) throw new Error('The sheet needs "Employee Code" and "Basic Salary" columns.');

  const out: SalaryImportRow[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const code = (row[codeCol] ?? "").trim().toUpperCase();
    if (!code && row.every((c) => !c.trim())) return;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!code) errors.push("Employee code is missing");

    const basic = parseAmount(row[basicCol] ?? "");
    if (basic === null) {
      // Rows without a salary are simply not imported (the template lists every employee).
      out.push({ rowNumber, employeeCode: code, basicSalary: null, effectiveFrom: null, allowances: [], errors: ["No basic salary entered — row skipped"], warnings });
      return;
    }
    if (Number.isNaN(basic) || basic < 0 || basic > MAX_AMOUNT) errors.push(`Basic salary "${row[basicCol]}" is not a valid amount`);

    let effectiveFrom: string | null = null;
    const effRaw = effCol >= 0 ? (row[effCol] ?? "").trim() : "";
    if (effRaw) {
      effectiveFrom = parseFlexibleDate(effRaw, today);
      if (!effectiveFrom) errors.push(`Effective date "${effRaw}" is not a valid date`);
    }

    const allowances: { name: string; amount: number }[] = [];
    for (const a of allowanceCols) {
      const amt = parseAmount(row[a.i] ?? "");
      if (amt === null || amt === 0) continue;
      if (Number.isNaN(amt) || amt < 0 || amt > MAX_AMOUNT) errors.push(`${a.name} allowance "${row[a.i]}" is not a valid amount`);
      else allowances.push({ name: a.name, amount: amt });
    }

    if (code && seen.has(code)) errors.push(`Employee code duplicates row ${seen.get(code)}`);
    else if (code) seen.set(code, rowNumber);

    out.push({ rowNumber, employeeCode: code, basicSalary: Number.isNaN(basic) ? null : basic, effectiveFrom, allowances, errors, warnings });
  });
  return out;
}
