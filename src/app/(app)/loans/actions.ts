"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import {
  cancelLoan, createLoan, decideLoan, recordCashRepayment, setMonthInstallment,
} from "@/server/services/loans";
import { MAX_LOAN_AMOUNT } from "@/core/loans/schedule";
import { optionalText, requiredText } from "@/lib/validation";
import type { ActionResult } from "@/server/errors";

function refresh(loanId?: string) {
  revalidatePath("/loans");
  if (loanId) revalidatePath(`/loans/${loanId}`);
  revalidatePath("/dashboard");
}

const monthField = (label: string) =>
  z
    .string({ error: `Choose the ${label}.` })
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, `Choose the ${label}.`)
    .transform((v) => ({ year: Number(v.slice(0, 4)), month: Number(v.slice(5, 7)) }));

const wholeRupees = (label: string, max: number) =>
  z.coerce
    .number({ error: `${label} must be a number.` })
    .int(`${label} must be in whole rupees.`)
    .min(1, `${label} must be more than 0.`)
    .max(max, `${label} can be at most ${max.toLocaleString("en-PK")}.`);

const loanSchema = z.object({
  employeeId: requiredText("Employee", 40),
  amount: wholeRupees("Amount", MAX_LOAN_AMOUNT),
  reason: z.string().trim().min(3, "Give a reason.").max(1000),
  givenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date given."),
  deductAmount: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), wholeRupees("Installment", MAX_LOAN_AMOUNT).optional()),
  deductMonth: z.string().optional(),
});

export async function createLoanAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = loanSchema.parse(formObject(fd));
    const deduct = input.deductAmount !== undefined ? { ...monthField("deduction month").parse(input.deductMonth), amount: input.deductAmount } : undefined;
    const loan = await createLoan(await requireActor(), { employeeId: input.employeeId, amount: input.amount, reason: input.reason, givenOn: input.givenOn, deduct });
    refresh(loan.id);
    revalidatePath("/payroll");
    return {
      ok: true,
      message: deduct ? "Loan added. The installment is deducted in that month's payroll." : "Loan added. Enter an installment on the loan for each month it should be deducted.",
    };
  });
}

export async function decideLoanAction(id: string, approve: boolean, note: string, start?: string): Promise<ActionResult> {
  return runAction(async () => {
    const month = start ? monthField("first deduction month").parse(start) : undefined;
    await decideLoan(await requireActor(), id, approve, z.string().max(1000).parse(note), month);
    refresh(id);
    return { ok: true, message: approve ? "Loan approved." : "Loan request rejected." };
  });
}

export async function cancelLoanAction(id: string, note: string): Promise<ActionResult> {
  return runAction(async () => {
    await cancelLoan(await requireActor(), id, z.string().max(1000).parse(note));
    refresh(id);
    return { ok: true, message: "Loan cancelled." };
  });
}

const installmentAmount = z.coerce.number({ error: "Enter an amount." }).int("Whole rupees only.").min(0, "The amount cannot be negative.").max(MAX_LOAN_AMOUNT);

/** The installment to deduct in one month; 0 or empty clears it (nothing deducted). */
export async function monthInstallmentAction(id: string, month: string, amount: string): Promise<ActionResult> {
  return runAction(async () => {
    const m = monthField("month").parse(month);
    const value = installmentAmount.parse(amount.trim() === "" ? "0" : amount.trim());
    await setMonthInstallment(await requireActor(), id, m.year, m.month, value);
    refresh(id);
    revalidatePath("/payroll");
    return { ok: true, message: value === 0 ? "Nothing will be deducted that month." : "Installment saved for that month." };
  });
}

const cashSchema = z.object({
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the payment date."),
  amount: wholeRupees("Amount", MAX_LOAN_AMOUNT),
  note: optionalText(500),
});

export async function cashRepaymentAction(id: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    await recordCashRepayment(await requireActor(), id, cashSchema.parse(formObject(fd)));
    refresh(id);
    return { ok: true, message: "Cash repayment recorded." };
  });
}
