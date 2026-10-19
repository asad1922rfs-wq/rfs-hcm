"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { formObject, runAction } from "@/server/action";
import {
  cancelLoan, createLoan, decideLoan, pauseMonth, recordCashRepayment, requestLoan, unpauseMonth,
} from "@/server/services/loans";
import { MAX_INSTALLMENTS, MAX_LOAN_AMOUNT } from "@/core/loans/schedule";
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
  amount: wholeRupees("Amount", MAX_LOAN_AMOUNT),
  installments: z.coerce.number({ error: "Enter the number of installments." }).int("Whole months only.").min(1, "At least 1 installment.").max(MAX_INSTALLMENTS, `At most ${MAX_INSTALLMENTS} installments.`),
  start: monthField("first deduction month"),
  reason: z.string().trim().min(3, "Give a reason.").max(1000),
});

const toInput = (v: z.infer<typeof loanSchema>) => ({ amount: v.amount, installments: v.installments, startYear: v.start.year, startMonth: v.start.month, reason: v.reason });

export async function requestLoanAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const loan = await requestLoan(await requireActor(), toInput(loanSchema.parse(formObject(fd))));
    refresh(loan.id);
    return { ok: true, message: "Loan requested. HR/Finance will review it." };
  });
}

export async function createLoanAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const input = loanSchema.extend({ employeeId: requiredText("Employee", 40) }).parse(formObject(fd));
    const loan = await createLoan(await requireActor(), { ...toInput(input), employeeId: input.employeeId });
    refresh(loan.id);
    return { ok: true, message: "Loan added. Installments are deducted in payroll from the first deduction month." };
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

export async function pauseMonthAction(id: string, month: string, pause: boolean): Promise<ActionResult> {
  return runAction(async () => {
    const m = monthField("month").parse(month);
    const actor = await requireActor();
    if (pause) await pauseMonth(actor, id, m.year, m.month);
    else await unpauseMonth(actor, id, m.year, m.month);
    refresh(id);
    revalidatePath("/payroll");
    return { ok: true, message: pause ? "No installment will be deducted that month." : "The installment is back on for that month." };
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
