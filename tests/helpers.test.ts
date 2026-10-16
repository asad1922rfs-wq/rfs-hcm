import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { daysInMonth, nextAnniversary, parseDateOnly, todayInPKT, yearsBetween } from "@/lib/dates";
import { formatMinuteOfDay, formatPKR, parseTimeOfDay } from "@/lib/format";
import { bankSchema, employeeSchema, formRows } from "@/lib/validation";
import { decryptField, encryptField, maskValue } from "@/server/crypto";

describe("dates", () => {
  it("parses and rejects calendar dates", () => {
    expect(parseDateOnly("2026-10-16").toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(() => parseDateOnly("2026-02-30")).toThrow();
    expect(() => parseDateOnly("16/10/2026")).toThrow();
  });

  it("evaluates 'today' in Pakistan time, not UTC", () => {
    // 20:30 UTC on 16 Oct is 01:30 on 17 Oct in Karachi (UTC+5).
    expect(todayInPKT(new Date("2026-10-16T20:30:00Z")).toISOString().slice(0, 10)).toBe("2026-10-17");
    expect(todayInPKT(new Date("2026-10-16T18:59:00Z")).toISOString().slice(0, 10)).toBe("2026-10-16");
  });

  it("knows month lengths (used for the per-day salary divisor)", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 11)).toBe(30);
  });

  it("finds the next anniversary, including 29 Feb", () => {
    const from = parseDateOnly("2026-10-16");
    expect(nextAnniversary(parseDateOnly("2020-10-16"), from).toISOString().slice(0, 10)).toBe("2026-10-16");
    expect(nextAnniversary(parseDateOnly("2020-10-15"), from).toISOString().slice(0, 10)).toBe("2027-10-15");
    expect(nextAnniversary(parseDateOnly("2020-02-29"), parseDateOnly("2027-01-01")).toISOString().slice(0, 10)).toBe("2027-02-28");
  });

  it("counts whole years", () => {
    expect(yearsBetween(parseDateOnly("2020-10-17"), parseDateOnly("2026-10-16"))).toBe(5);
    expect(yearsBetween(parseDateOnly("2020-10-16"), parseDateOnly("2026-10-16"))).toBe(6);
  });
});

describe("format", () => {
  it("formats PKR", () => {
    expect(formatPKR(80000)).toMatch(/80,000/);
  });

  it("round-trips shift times", () => {
    expect(parseTimeOfDay("14:00")).toBe(840);
    expect(formatMinuteOfDay(840)).toBe("2:00 PM");
    expect(formatMinuteOfDay(23 * 60)).toBe("11:00 PM");
    expect(() => parseTimeOfDay("24:00")).toThrow();
  });
});

describe("field encryption", () => {
  beforeAll(() => {
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptField("PK36SCBL0000001123456702");
    const b = encryptField("PK36SCBL0000001123456702");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("PK36SCBL0000001123456702");
  });

  it("detects tampering", () => {
    const enc = encryptField("12345678");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join("."))).toThrow();
  });

  it("masks values", () => {
    expect(maskValue("0123456789")).toBe("•••• 6789");
  });
});

describe("validation", () => {
  const base = { employeeCode: "RFS-0001", fullName: "Ayesha Khan", joiningDate: "2026-01-05", employmentType: "PERMANENT" };

  it("accepts a minimal employee and treats blanks as missing", () => {
    const parsed = employeeSchema.parse({ ...base, email: "", phone: "", departmentId: "" });
    expect(parsed.email).toBeUndefined();
    expect(parsed.departmentId).toBeUndefined();
    expect(parsed.joiningDate.toISOString().slice(0, 10)).toBe("2026-01-05");
  });

  it("validates CNIC format", () => {
    expect(employeeSchema.safeParse({ ...base, cnic: "35202-1234567-1" }).success).toBe(true);
    expect(employeeSchema.safeParse({ ...base, cnic: "3520212345671" }).success).toBe(false);
  });

  it("normalises and validates Pakistani IBANs", () => {
    const ok = bankSchema.parse({ bankName: "Meezan", accountTitle: "A Khan", accountNumber: "0101-123", iban: "pk36 scbl 0000 0011 2345 6702" });
    expect(ok.iban).toBe("PK36SCBL0000001123456702");
    expect(bankSchema.safeParse({ bankName: "X", accountTitle: "Y", accountNumber: "1", iban: "GB00XXXX" }).success).toBe(false);
  });

  it("collects repeated form rows and drops empty ones", () => {
    const fd = new FormData();
    fd.append("allowances.name", "Fuel");
    fd.append("allowances.amount", "5000");
    fd.append("allowances.name", "");
    fd.append("allowances.amount", "");
    expect(formRows(fd, "allowances", ["name", "amount"] as const)).toEqual([{ name: "Fuel", amount: "5000" }]);
  });
});
