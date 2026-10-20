"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Ban, Check, Loader2, Pencil, Plus, RotateCcw, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { installmentPlan, MAX_INSTALLMENTS } from "@/core/loans/schedule";
import { formatPKR } from "@/lib/format";
import { cancelLoanAction, cashRepaymentAction, changeInstallmentAction, createLoanAction, decideLoanAction, monthInstallmentAction } from "./actions";

type Option = { id: string; label: string };

/** "Add loan" for HR/Finance. Employees do not request loans themselves. */
export function LoanFormDialog({ employees, minMonth, defaultMonth, trigger }: { employees: Option[]; minMonth: string; defaultMonth: string; trigger: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(createLoanAction, null);
  const [amount, setAmount] = useState("");
  const [installments, setInstallments] = useState("6");
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setOpen(false);
    }
  }, [state]);

  const a = Number(amount);
  const n = Number(installments);
  const valid = Number.isInteger(a) && a > 0 && Number.isInteger(n) && n >= 1 && n <= MAX_INSTALLMENTS && n <= a;
  const plan = valid ? installmentPlan(a, n) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Plus className="size-4" /> {trigger}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a loan for an employee</DialogTitle>
          <DialogDescription>
            Interest-free. The installment is deducted from salary every month from the first deduction month. A loan added
            here is approved immediately.
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
            <Field label="Amount (Rs)" name="amount" type="number" min={1} step={1} inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value)} errors={fe?.amount} />
            <Field label="Monthly installments" name="installments" type="number" min={1} max={MAX_INSTALLMENTS} step={1} required value={installments} onChange={(e) => setInstallments(e.target.value)} errors={fe?.installments} />
          </div>
          {plan && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              {n === 1 ? (
                <>One deduction of <strong>{formatPKR(plan.last)}</strong>.</>
              ) : plan.last === plan.regular ? (
                <><strong>{formatPKR(plan.regular)}</strong> a month for {n} months.</>
              ) : (
                <><strong>{formatPKR(plan.regular)}</strong> a month for {n - 1} months, then {formatPKR(plan.last)}.</>
              )}
            </p>
          )}
          <Field label="First deduction month" name="start" type="month" min={minMonth} defaultValue={defaultMonth} required errors={fe?.start} hint="Salary for this month is the first one reduced." />
          <div className="grid gap-1.5">
            <Label htmlFor="f-reason">Reason<span className="text-destructive"> *</span></Label>
            <Textarea id="f-reason" name="reason" required rows={3} maxLength={1000} placeholder="e.g. Medical expenses, house rent advance" aria-invalid={fe?.reason ? true : undefined} />
            {fe?.reason && <p className="text-xs text-destructive">{fe.reason[0]}</p>}
          </div>
          <SubmitButton>Add loan</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Approve (optionally moving the first deduction month) or reject a pending request. */
export function DecideLoanButtons({ id, name, startMonth, minMonth }: { id: string; name: string; startMonth: string; minMonth: string }) {
  const [note, setNote] = useState("");
  const [start, setStart] = useState(startMonth < minMonth ? minMonth : startMonth);
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [pending, run] = useTransition();
  const decide = (approve: boolean) =>
    run(async () => {
      const r = await decideLoanAction(id, approve, note, approve ? start : undefined);
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
            <DialogDescription>{mode === "approve" ? "Installments are deducted in payroll from the month below." : "The employee will see your note."}</DialogDescription>
          </DialogHeader>
          {mode === "approve" && (
            <div className="grid gap-1.5">
              <Label htmlFor={`start-${id}`}>First deduction month</Label>
              <Input id={`start-${id}`} type="month" min={minMonth} value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
          )}
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
            {running ? "No further installments are deducted and the outstanding balance is written off. This is recorded in the audit log." : "The request is withdrawn."}
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
          <DialogDescription>Money paid back outside payroll. It lowers the balance, so the loan finishes sooner. Outstanding: {formatPKR(outstanding)}.</DialogDescription>
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

/** "Change this month's installment" (0 skips the month) and "Reset to regular" for one upcoming month. */
export function MonthInstallmentButtons({ id, month, label, amount, adjusted, max }: { id: string; month: string; label: string; amount: number; adjusted: boolean; max: number }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(amount));
  const [pending, run] = useTransition();
  const submit = (next: string | null) =>
    run(async () => {
      const r = await monthInstallmentAction(id, month, next);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.error);
    });
  return (
    <div className="flex justify-end gap-1">
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(String(amount)); }}>
        <DialogTrigger asChild>
          <Button size="xs" variant="ghost" aria-label={`Change the installment for ${label}`}><Pencil /> Change</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change this month&apos;s installment · {label}</DialogTitle>
            <DialogDescription>
              Deduct a different amount in this month only — higher or lower than the regular installment. Enter 0 to skip the month; the schedule then runs a month longer. At most {formatPKR(max)} (the outstanding balance).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`m-${id}-${month}`}>Amount (Rs)</Label>
            <Input id={`m-${id}-${month}`} type="number" min={0} max={max} step={1} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
          <Button disabled={pending || value.trim() === ""} onClick={() => submit(value.trim())}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </DialogContent>
      </Dialog>
      {adjusted && (
        <Button size="xs" variant="ghost" disabled={pending} aria-label={`Reset ${label} to the regular installment`} onClick={() => submit(null)}>
          {pending ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset to regular
        </Button>
      )}
    </div>
  );
}

/** Change the regular monthly installment of a running loan from the next open payroll month. */
export function ChangeInstallmentDialog({ id, current, max }: { id: string; current: number; max: number }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current));
  const [pending, run] = useTransition();
  const save = () =>
    run(async () => {
      const r = await changeInstallmentAction(id, value.trim());
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.error);
    });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Pencil className="size-4" /> Change monthly installment</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change monthly installment</DialogTitle>
          <DialogDescription>
            From the next open payroll month this amount is deducted every month and the final installment takes what is left. Months already paid and months you changed individually stay as they are. Recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={`inst-${id}`}>Monthly installment (Rs)</Label>
          <Input id={`inst-${id}`} type="number" min={1} max={max} step={1} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button disabled={pending || value.trim() === ""} onClick={save}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Save
        </Button>
      </DialogContent>
    </Dialog>
  );
}
