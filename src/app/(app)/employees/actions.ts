"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import {
  addSalaryStructure, createEmployee, deleteEmployees, revealBankDetails, setEmployeeStatus, updateEmployee, upsertBankAccount, updateOwnProfile,
} from "@/server/services/employees";
import {
  allowanceSchema, bankSchema, emergencyContactSchema, employeeSchema, EMPLOYMENT_STATUSES, formRows, money, optionalDate, optionalText, salarySchema,
} from "@/lib/validation";
import type { ActionResult } from "@/server/errors";

function parseEmergencyContacts(fd: FormData) {
  return z.array(emergencyContactSchema).max(5).parse(formRows(fd, "contacts", ["name", "relationship", "phone"] as const));
}

function parseAllowances(fd: FormData) {
  return z.array(allowanceSchema).max(20).parse(formRows(fd, "allowances", ["name", "amount"] as const));
}

export async function createEmployeeAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const result = await runAction<{ id: string }>(async () => {
    const actor = await requireActor();
    const raw = formObject(fd);
    const input = employeeSchema.parse(raw);
    const emergencyContacts = parseEmergencyContacts(fd);

    const salary = raw.basicSalary?.trim()
      ? { basicSalary: money("Basic salary").parse(raw.basicSalary), allowances: parseAllowances(fd), note: undefined }
      : null;
    const bank = raw.bankName?.trim() || raw.accountNumber?.trim() ? bankSchema.parse(raw) : null;

    const employee = await createEmployee(actor, input, { salary, bank, emergencyContacts });
    return { ok: true, data: { id: employee.id } };
  });
  if (result.ok && result.data) {
    revalidatePath("/employees");
    redirect(`/employees/${result.data.id}`);
  }
  return result as ActionResult;
}

export async function updateEmployeeAction(employeeId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const result = await runAction(async () => {
    const actor = await requireActor();
    await updateEmployee(actor, employeeId, employeeSchema.parse(formObject(fd)), parseEmergencyContacts(fd));
    return { ok: true };
  });
  if (result.ok) {
    revalidatePath(`/employees/${employeeId}`);
    redirect(`/employees/${employeeId}`);
  }
  return result;
}

const statusSchema = z.object({ status: z.enum(EMPLOYMENT_STATUSES), exitDate: optionalDate("Exit date") });

export async function setStatusAction(employeeId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = statusSchema.parse(formObject(fd));
    await setEmployeeStatus(actor, employeeId, input.status, input.exitDate ?? null);
    revalidatePath(`/employees/${employeeId}`);
    return { ok: true, message: "Status updated." };
  });
}

export async function addSalaryAction(employeeId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formObject(fd);
    const input = salarySchema.parse({ ...raw, allowances: parseAllowances(fd) });
    await addSalaryStructure(actor, employeeId, input);
    revalidatePath(`/employees/${employeeId}`);
    return { ok: true, message: "Salary revision saved." };
  });
}

export async function saveBankAction(employeeId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    await upsertBankAccount(actor, employeeId, bankSchema.parse(formObject(fd)));
    revalidatePath(`/employees/${employeeId}`);
    return { ok: true, message: "Bank details saved." };
  });
}

export async function revealBankAction(employeeId: string): Promise<ActionResult<{ accountNumber: string; iban: string | null }>> {
  return runAction(async () => {
    const actor = await requireActor();
    return { ok: true, data: await revealBankDetails(actor, employeeId) };
  });
}

export async function deleteEmployeesAction(employeeIds: string[], confirmation: string): Promise<ActionResult<{ deleted: number }>> {
  const result = await runAction<{ deleted: number }>(async () => {
    const actor = await requireActor();
    const ids = z.array(z.string().min(1).max(40)).max(200).parse(employeeIds);
    const r = await deleteEmployees(actor, ids, z.string().max(40).parse(confirmation));
    revalidatePath("/employees");
    revalidatePath("/dashboard");
    return { ok: true, data: r };
  });
  return result;
}

const selfSchema = z.object({
  phone: z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,19}$/, "Enter a valid phone number.").optional()),
  address: optionalText(300),
});

export async function updateOwnProfileAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = selfSchema.parse(formObject(fd));
    await updateOwnProfile(actor, { ...input, emergencyContacts: parseEmergencyContacts(fd) });
    revalidatePath("/me");
    return { ok: true, message: "Your details were updated." };
  });
}
