"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { RowEditor } from "@/components/row-editor";
import { humanize } from "@/components/common";
import { EMPLOYMENT_STATUSES } from "@/lib/validation";
import { addSalaryAction, deleteSalaryAction, revealBankAction, saveBankAction, setStatusAction, updateSalaryAction } from "../actions";
import type { ActionResult } from "@/server/errors";

export function StatusDialog({ employeeId, status }: { employeeId: string; status: string }) {
  const [state, action] = useActionState(setStatusAction.bind(null, employeeId), null);
  const [next, setNext] = useState(status);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">{status === "ACTIVE" ? "Deactivate / exit" : "Change status"}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Employment status</DialogTitle>
          <DialogDescription>Employees who are not active cannot sign in, and their sessions are ended immediately.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <FormMessage state={state} />
          <Field label="Status" name="status">
            <NativeSelect id="f-status" name="status" value={next} onChange={(e) => setNext(e.target.value)}>
              {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </NativeSelect>
          </Field>
          {(next === "RESIGNED" || next === "TERMINATED") && (
            <Field label="Exit date" name="exitDate" type="date" required errors={fe?.exitDate} />
          )}
          <SubmitButton>Save status</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SalaryRevisionDialog({ employeeId, defaultDate }: { employeeId: string; defaultDate: string }) {
  const [state, action] = useActionState(addSalaryAction.bind(null, employeeId), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">Add salary revision</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Salary revision</DialogTitle>
          <DialogDescription>Applies from the effective date onward. Earlier payroll is not affected.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <FormMessage state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effective from" name="effectiveFrom" type="date" defaultValue={defaultDate} required errors={fe?.effectiveFrom} />
            <Field label="Monthly basic salary (PKR)" name="basicSalary" type="number" min={0} step="0.01" required errors={fe?.basicSalary} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Fixed monthly allowances</p>
            <RowEditor
              prefix="allowances"
              addLabel="Add allowance"
              columns={[
                { key: "name", label: "Allowance" },
                { key: "amount", label: "Amount (PKR)", type: "number", inputMode: "decimal" },
              ]}
            />
          </div>
          <Field label="Note" name="note" placeholder="e.g. Annual increment" errors={fe?.note} />
          <SubmitButton>Save revision</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const DRAFT_NOTE = "Draft payroll is not recalculated automatically: use Recalculate on the payroll page afterwards.";

export type SalaryRevisionRow = {
  id: string;
  effectiveFrom: string;
  basicSalary: string;
  note: string | null;
  allowances: { name: string; amount: string }[];
  /** Why it cannot be edited or deleted (approved / paid payroll in its month), or null. */
  lockedReason: string | null;
};

export function EditSalaryRevisionDialog({ employeeId, revision }: { employeeId: string; revision: SalaryRevisionRow }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateSalaryAction.bind(null, employeeId, revision.id), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Salary revision updated.");
      setOpen(false);
    }
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Edit revision" disabled={!!revision.lockedReason} title={revision.lockedReason ?? "Edit revision"}>
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit salary revision</DialogTitle>
          <DialogDescription>{DRAFT_NOTE} Approved and paid payslips are not changed.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <FormMessage state={state && !state.ok ? state : null} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effective from" name="effectiveFrom" type="date" defaultValue={revision.effectiveFrom} required errors={fe?.effectiveFrom} />
            <Field label="Monthly basic salary (PKR)" name="basicSalary" type="number" min={0} step="0.01" defaultValue={revision.basicSalary} required errors={fe?.basicSalary} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Fixed monthly allowances</p>
            <RowEditor
              prefix="allowances"
              addLabel="Add allowance"
              initial={revision.allowances}
              columns={[
                { key: "name", label: "Allowance" },
                { key: "amount", label: "Amount (PKR)", type: "number", inputMode: "decimal" },
              ]}
            />
          </div>
          <Field label="Note" name="note" defaultValue={revision.note ?? ""} errors={fe?.note} />
          <SubmitButton>Save changes</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirm-then-delete button for a row (salary revision, sales month). */
export function ConfirmDeleteButton({
  title, description, disabledReason, onDelete,
}: {
  title: string;
  description: string;
  disabledReason?: string | null;
  onDelete: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={title} disabled={!!disabledReason} title={disabledReason ?? title}>
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}?</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await onDelete();
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message ?? "Deleted.");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="size-4 animate-spin" />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SalaryRevisionActions({ employeeId, revision, isOnly }: { employeeId: string; revision: SalaryRevisionRow; isOnly: boolean }) {
  return (
    <div className="flex justify-end">
      <EditSalaryRevisionDialog employeeId={employeeId} revision={revision} />
      <ConfirmDeleteButton
        title="Delete salary revision"
        description={`${isOnly ? "This is the only salary revision: the employee will have no salary until a new one is added. " : ""}${DRAFT_NOTE} The deletion is recorded in the audit log.`}
        disabledReason={revision.lockedReason}
        onDelete={() => deleteSalaryAction(employeeId, revision.id)}
      />
    </div>
  );
}

export function BankDialog({
  employeeId, current,
}: {
  employeeId: string;
  current: { bankName: string; branch: string | null; accountTitle: string } | null;
}) {
  const [state, action] = useActionState(saveBankAction.bind(null, employeeId), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">{current ? "Update bank details" : "Add bank details"}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bank details</DialogTitle>
          <DialogDescription>Account number and IBAN are encrypted at rest. Re-enter them to change any detail.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <FormMessage state={state} />
          <Field label="Bank name" name="bankName" defaultValue={current?.bankName} required errors={fe?.bankName} />
          <Field label="Branch" name="branch" defaultValue={current?.branch ?? ""} errors={fe?.branch} />
          <Field label="Account title" name="accountTitle" defaultValue={current?.accountTitle} required errors={fe?.accountTitle} />
          <Field label="Account number" name="accountNumber" required autoComplete="off" errors={fe?.accountNumber} />
          <Field label="IBAN" name="iban" autoComplete="off" errors={fe?.iban} />
          <SubmitButton>Save bank details</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RevealBank({ employeeId, masked }: { employeeId: string; masked: { accountNumber: string; iban: string | null } }) {
  const [revealed, setRevealed] = useState<{ accountNumber: string; iban: string | null } | null>(null);
  const [pending, start] = useTransition();
  const shown = revealed ?? masked;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account number</p>
        <p className="mt-1 font-mono text-sm">{shown.accountNumber}</p>
      </div>
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">IBAN</p>
        <p className="mt-1 font-mono text-sm">{shown.iban ?? "—"}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        disabled={pending}
        onClick={() => {
          if (revealed) return setRevealed(null);
          start(async () => {
            const res = await revealBankAction(employeeId);
            if (res.ok && res.data) setRevealed(res.data);
            else if (!res.ok) toast.error(res.error);
          });
        }}
      >
        {revealed ? <><EyeOff className="size-4" /> Hide</> : <><Eye className="size-4" /> Reveal (logged)</>}
      </Button>
    </div>
  );
}
