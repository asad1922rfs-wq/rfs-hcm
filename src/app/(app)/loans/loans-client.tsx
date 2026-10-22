"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Loader2, Plus, RotateCcw, Save, Trash2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { formatPKR } from "@/lib/format";
import { cancelLoanAction, cashRepaymentAction, clearMonthInstallmentAction, createLoanAction, decideLoanAction, deleteLoanAction, monthInstallmentAction } from "./actions";

type Option = { id: string; label: string };

/** "Add loan" for HR/Finance. Employees do not request loans themselves. There is no monthly plan. */
export function LoanFormDialog({ employees, minMonth, defaultMonth, today, trigger }: { employees: Option[]; minMonth: string; defaultMonth: string; today: string; trigger: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createLoanAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="size-4" /> {trigger}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a loan for an employee</DialogTitle>
          <DialogDescription>
            Interest-free. The installment you enter for a month is deducted from that month&apos;s salary. Not entered =
            repeats the last amount; enter 0 to skip a month. A loan added here is approved immediately.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          <Field label="Employee" name="employeeId" errors={fe?.employeeId}>
            <NativeSelect id="f-employeeId" name="employeeId" required>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount (Rs)" name="amount" type="number" min={1} step={1} inputMode="numeric" required errors={fe?.amount} />
            <Field label="Date given" name="givenOn" type="date" max={today} defaultValue={today} required errors={fe?.givenOn} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-reason">Reason<span className="text-destructive"> *</span></Label>
            <Textarea id="f-reason" name="reason" required rows={3} maxLength={1000} placeholder="e.g. Medical expenses, house rent advance" aria-invalid={fe?.reason ? true : undefined} />
            {fe?.reason && <p className="text-xs text-destructive">{fe.reason[0]}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deduct this month (Rs)" name="deductAmount" type="number" min={1} step={1} inputMode="numeric" errors={fe?.deductAmount} hint="Repeats every month until you change it. Leave empty to enter it later." />
            <Field label="Month" name="deductMonth" type="month" min={minMonth} defaultValue={defaultMonth} errors={fe?.deductMonth} />
          </div>
          <SubmitButton>Add loan</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approve or reject a pending request (from before employees stopped requesting loans). */
export function DecideLoanButtons({ id, name }: { id: string; name: string }) {
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [pending, run] = useTransition();
  const decide = (approve: boolean) =>
    run(async () => {
      const r = await decideLoanAction(id, approve, note);
      if (r.ok) {
        toast.success(r.message);
        setMode(null);
      } else toast.error(r.error);
    });
  return (
    <div className="flex justify-end gap-1">
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <Button size="sm" onClick={() => setMode("approve")} aria-label={`Approve loan for ${name}`}><Check className="size-3.5" /> Approve</Button>
        <Button size="sm" variant="outline" onClick={() => setMode("reject")} aria-label={`Reject loan for ${name}`}><X className="size-3.5" /> Reject</Button>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "approve" ? "Approve loan" : "Reject loan"} · {name}</DialogTitle>
            <DialogDescription>{mode === "approve" ? "Afterwards, enter the installment on the loan. Not entered = repeats the last amount; enter 0 to skip a month." : "The employee will see your note."}</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "approve" ? "Note (optional)" : "Reason (required)"} rows={3} maxLength={1000} />
          <Button variant={mode === "approve" ? "default" : "destructive"} disabled={pending} onClick={() => decide(mode === "approve")}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {mode === "approve" ? "Approve" : "Reject"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Cancel a running loan (note required — the balance is written off) or withdraw a pending request. */
export function CancelLoanButton({ id, running, label }: { id: string; running: boolean; label: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, run] = useTransition();
  const cancel = () =>
    run(async () => {
      const r = await cancelLoanAction(id, note);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Ban className="size-4" /> {label}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {running ? "Nothing more is deducted and the outstanding balance is written off. This is recorded in the audit log." : "The request is withdrawn."}
          </DialogDescription>
        </DialogHeader>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={running ? "Reason (required)" : "Note (optional)"} rows={3} maxLength={1000} />
        <Button variant="destructive" disabled={pending} onClick={cancel}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {label}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Delete a loan entered by mistake. Disabled once an approved payroll has deducted from it. */
export function DeleteLoanButton({ id, name, amount, blocked, compact, redirectTo }: {
  id: string; name: string; amount: number; blocked: boolean; compact?: boolean; redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, run] = useTransition();
  const router = useRouter();
  const button = (
    <Button variant={compact ? "ghost" : "outline"} size={compact ? "sm" : "default"} disabled={blocked} aria-label="Delete loan" className={compact ? "text-destructive" : undefined}>
      <Trash2 className="size-4" /> {!compact && "Delete"}
    </Button>
  );
  if (blocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0} className="inline-flex">{button}</span></TooltipTrigger>
        <TooltipContent>Has payroll repayments — cancel it instead</TooltipContent>
      </Tooltip>
    );
  }
  const remove = () =>
    run(async () => {
      const r = await deleteLoanAction(id);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
        if (redirectTo) router.push(redirectTo);
      } else toast.error(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{button}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete loan?</DialogTitle>
          <DialogDescription>
            The {formatPKR(amount)} loan of {name} is removed with its cash repayments and month entries. This cannot be undone; a copy is kept in the audit log.
          </DialogDescription>
        </DialogHeader>
        <Button variant="destructive" disabled={pending} onClick={remove}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Delete loan
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function CashRepaymentDialog({ id, outstanding, today }: { id: string; outstanding: number; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(cashRepaymentAction.bind(null, id), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setOpen(false);
    }
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Wallet className="size-4" /> Record cash payment</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record cash repayment</DialogTitle>
          <DialogDescription>Money paid back outside payroll. It lowers the balance. Outstanding: {formatPKR(outstanding)}.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid on" name="paidOn" type="date" max={today} defaultValue={today} required errors={fe?.paidOn} />
            <Field label="Amount (Rs)" name="amount" type="number" min={1} max={outstanding} step={1} required errors={fe?.amount} />
          </div>
          <Field label="Note" name="note" placeholder="e.g. Receipt no., bank transfer reference" errors={fe?.note} />
          <SubmitButton>Record payment</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The installment for one open month: an amount field and Save (0 = skip the month), plus "Use default" to remove
 * the entry so the month repeats the last amount again.
 */
export function MonthInstallmentField({ id, month, label, entered, placeholder, max }: { id: string; month: string; label: string; entered: number | null; placeholder: string; max: number }) {
  const shown = entered === null ? "" : String(entered);
  const [value, setValue] = useState(shown);
  const [pending, run] = useTransition();
  useEffect(() => setValue(shown), [shown]);
  const dirty = value.trim() !== "" && value.trim() !== shown;
  const go = (action: () => ReturnType<typeof monthInstallmentAction>) =>
    run(async () => {
      const r = await action();
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  return (
    <form
      className="flex items-center justify-end gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        go(() => monthInstallmentAction(id, month, value.trim()));
      }}
    >
      <Input
        type="number" min={0} max={max} step={1} inputMode="numeric" placeholder={placeholder} className="h-8 w-28 text-right"
        aria-label={`Installment for ${label} (Rs, 0 skips the month)`} value={value} onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !dirty} aria-label={`Save the installment for ${label}`}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
      </Button>
      {entered !== null && (
        <Button
          type="button" size="sm" variant="ghost" disabled={pending} title="Clear the entry: the month repeats the last amount"
          aria-label={`Use the default for ${label}`} onClick={() => go(() => clearMonthInstallmentAction(id, month))}
        >
          <RotateCcw className="size-3.5" /> Use default
        </Button>
      )}
    </form>
  );
}
