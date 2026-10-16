import { describe, expect, it } from "vitest";
import { parseAmount, parseSalaryRows } from "@/core/payroll/salary-import";

const HEADER = ["Employee Code", "Name", "Effective From", "Basic Salary", "Allowance: Fuel", "Allowance: Mobile"];

describe("parseAmount", () => {
  it("accepts PKR formats", () => {
    expect(parseAmount("80,000")).toBe(80000);
    expect(parseAmount("Rs. 80,000.50")).toBe(80000.5);
    expect(parseAmount("PKR 5000")).toBe(5000);
    expect(parseAmount("")).toBeNull();
    expect(Number.isNaN(parseAmount("eighty"))).toBe(true);
    expect(Number.isNaN(parseAmount("-500"))).toBe(true);
  });
});

describe("parseSalaryRows", () => {
  it("reads basic salary and named allowance columns", () => {
    const [r] = parseSalaryRows(HEADER, [["rf-119", "X", "", "80,000", "5000", "0"]]);
    expect(r).toMatchObject({ employeeCode: "RF-119", basicSalary: 80000, effectiveFrom: null, allowances: [{ name: "Fuel", amount: 5000 }], errors: [] });
  });

  it("parses effective dates and skips rows with no salary", () => {
    const rows = parseSalaryRows(HEADER, [["17", "X", "01-Nov-26", "120000", "", ""], ["18", "Y", "", "", "", ""]], new Date("2026-10-16T00:00:00Z"));
    expect(rows[0]!.effectiveFrom).toBe("2026-11-01");
    expect(rows[1]!.errors[0]).toMatch(/No basic salary/);
  });

  it("rejects invalid amounts and duplicate codes", () => {
    const rows = parseSalaryRows(HEADER, [["17", "", "", "abc", "", ""], ["18", "", "", "1000", "x", ""], ["18", "", "", "2000", "", ""]]);
    expect(rows[0]!.errors.join()).toMatch(/not a valid amount/);
    expect(rows[1]!.errors.join()).toMatch(/Fuel allowance/);
    expect(rows[2]!.errors.join()).toMatch(/duplicates row/);
  });

  it("requires the key columns", () => {
    expect(() => parseSalaryRows(["Name", "Salary"], [])).toThrow(/Employee Code/);
  });
});
