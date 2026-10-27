import { z } from "zod";
import { parseDateOnly } from "./dates";
import { WORK_MODES } from "@/core/attendance/web-punch";

// Shared input schemas. Used by server actions (authoritative) and by forms for field hints.

/** Treat "" from HTML forms as "not provided". */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const optionalText = (max = 200) => z.preprocess(blank, z.string().trim().max(max).optional());
export const requiredText = (label: string, max = 200) =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(max);

export const dateOnly = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .refine((v) => {
      try {
        parseDateOnly(v);
        return true;
      } catch {
        return false;
      }
    }, `${label} must be a valid date.`)
    .transform((v) => parseDateOnly(v));

export const optionalDate = (label: string) => z.preprocess(blank, dateOnly(label).optional());

export const optionalId = z.preprocess(blank, z.string().trim().max(40).optional());

export const money = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .min(0, `${label} cannot be negative.`)
    .max(100_000_000, `${label} is too large.`)
    .refine((n) => Number.isInteger(Math.round(n * 100)), `${label} can have at most 2 decimal places.`);

export { WORK_MODES };
/** Designation select value meaning "create the title typed in newDesignation". */
export const NEW_DESIGNATION = "__new__";
export const EMPLOYMENT_TYPES = ["PERMANENT", "PROBATION", "CONTRACT", "INTERN", "PART_TIME"] as const;
export const EMPLOYMENT_STATUSES = ["ACTIVE", "INACTIVE", "RESIGNED", "TERMINATED"] as const;
export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;

export const employeeSchema = z.object({
  employeeCode: requiredText("Employee ID", 20).regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, - or _ only."),
  fullName: requiredText("Full name", 120).min(2, "Full name is too short."),
  email: z.preprocess(blank, z.email("Enter a valid email address.").toLowerCase().optional()),
  phone: z.preprocess(blank, z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,19}$/, "Enter a valid phone number.").optional()),
  gender: z.preprocess(blank, z.enum(GENDERS).optional()),
  dateOfBirth: optionalDate("Date of birth"),
  cnic: z.preprocess(blank, z.string().trim().regex(/^\d{5}-\d{7}-\d$/, "CNIC format is 12345-1234567-1.").optional()),
  address: optionalText(300),
  joiningDate: dateOnly("Joining date"),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  departmentId: optionalId,
  designationId: optionalId,
  shiftId: optionalId,
  managerId: optionalId,
  deviceUserId: z.preprocess(blank, z.string().trim().max(20).regex(/^[0-9A-Za-z]+$/, "Letters and numbers only.").optional()),
  workMode: z.preprocess(blank, z.enum(WORK_MODES, { message: "Choose a work mode." }).default("OFFICE")),
  /** Remote only: flexible hours (9h minimum) apply from this date. Blank keeps the current date, or tomorrow. */
  flexibleFrom: optionalDate("Flexible hours from"),
  /** Title typed after choosing "+ Add new designation…" (designationId = NEW_DESIGNATION). */
  newDesignation: optionalText(100),
}).superRefine((v, ctx) => {
  if (v.designationId === NEW_DESIGNATION && !v.newDesignation) {
    ctx.addIssue({ code: "custom", path: ["newDesignation"], message: "Enter the new designation title." });
  }
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const emergencyContactSchema = z.object({
  name: requiredText("Contact name", 120),
  relationship: requiredText("Relationship", 60),
  phone: z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,19}$/, "Enter a valid phone number."),
});

export const allowanceSchema = z.object({
  name: requiredText("Allowance name", 60),
  amount: money("Allowance amount"),
});

export const salarySchema = z.object({
  effectiveFrom: dateOnly("Effective from"),
  basicSalary: money("Basic salary"),
  allowances: z.array(allowanceSchema).max(20),
  note: optionalText(300),
});
export type SalaryInput = z.infer<typeof salarySchema>;

export const bankSchema = z.object({
  bankName: requiredText("Bank name", 100),
  branch: optionalText(100),
  accountTitle: requiredText("Account title", 120),
  accountNumber: requiredText("Account number", 34).regex(/^[0-9A-Za-z-]+$/, "Letters, numbers and - only."),
  iban: z.preprocess(
    blank,
    z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .pipe(z.string().regex(/^PK\d{2}[A-Z]{4}\d{16}$/, "Pakistani IBAN format is PK + 2 digits + 4-letter bank code + 16 digits."))
      .optional(),
  ),
});
export type BankInput = z.infer<typeof bankSchema>;

/** Flatten zod issues into { field: [messages] } for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/** Collect repeated form rows like name="allowances.name" / name="allowances.amount" into objects. */
export function formRows<K extends string>(fd: FormData, prefix: string, keys: readonly K[]): Record<K, string>[] {
  const columns = keys.map((k) => fd.getAll(`${prefix}.${k}`).map(String));
  const length = Math.max(0, ...columns.map((c) => c.length));
  const rows: Record<K, string>[] = [];
  for (let i = 0; i < length; i++) {
    const row = Object.fromEntries(keys.map((k, j) => [k, columns[j]![i] ?? ""])) as Record<K, string>;
    if (keys.some((k) => row[k].trim() !== "")) rows.push(row);
  }
  return rows;
}
