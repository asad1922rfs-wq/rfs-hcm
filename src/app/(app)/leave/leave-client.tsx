"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { cancelLeaveAction, decideLeaveAction, requestLeaveAction } from "./actions";

type Option = { id: string; label: string };

export function RequestLeaveDialog({
  types, employees, trigger,
}: {
  /** `ineligibleReason` set = the requesting employee cannot take this type (shown disabled); `permanentOnly` is marked in HR's list. */
  types: (Option & { remaining: number | null; isPaid: boolean; permanentOnly: boolean; ineligibleReason: string | null })[];
  employees?: Option[];
  trigger: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(requestLeaveAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const firstEligible = types.find((t) => !t.ineligibleReason);
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>{trigger}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{employees ? "Record leave for an employee" : "Request leave"}</DialogTitle>
          <DialogDescription>
            Only working days are counted — weekly off days inside the dates are free.
            {employees ? " Leave recorded by HR is approved immediately." : " Your manager or HR approves it."}
          </DialogDescription>
        </DialogHeader>
        {types.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave types are set up yet. HR adds them under Administration → Leave types.</p>
        ) : !firstEligible ? (
          <p className="text-sm text-muted-foreground">Leave is available after confirmation as a permanent employee.</p>
        ) : (
          <form action={action} className="grid gap-4">
            {state && !state.ok && <FormMessage state={state} />}
            {employees && (
              <Field label="Employee" name="employeeId">
                <NativeSelect id="f-employeeId" name="employeeId" required>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                </NativeSelect>
              </Field>
            )}
            <Field label="Leave type" name="leaveTypeId" errors={fe?.leaveTypeId}>
              <NativeSelect id="f-leaveTypeId" name="leaveTypeId" defaultValue={firstEligible.id}>
                {types.map((t) => (
                  <option key={t.id} value={t.id} disabled={!!t.ineligibleReason}>
                    {t.label}{t.isPaid ? "" : " (unpaid)"}
                    {t.ineligibleReason
                      ? ` — ${t.ineligibleReason}`
                      : employees
                        ? (t.permanentOnly ? " — permanent employees only" : "")
                        : t.remaining !== null ? ` — ${t.remaining} day(s) left` : ""}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="From" name="startDate" type="date" required errors={fe?.startDate} />
              <Field label="To" name="endDate" type="date" required errors={fe?.endDate} />
            </div>
            <Field label="Reason" name="reason" required errors={fe?.reason} placeholder="e.g. Family wedding, medical appointment" />
            <SubmitButton>{employees ? "Record leave" : "Send request"}</SubmitButton>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DecideButtons({ id, name }: { id: string; name: string }) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await decideLeaveAction(id, approve, note);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.error);
    });
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" disabled={pending} onClick={() => decide(true)} aria-label={`Approve leave for ${name}`}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="outline" aria-label={`Reject leave for ${name}`}><X className="size-3.5" /> Reject</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject leave · {name}</DialogTitle>
            <DialogDescription>The employee will see your note.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" rows={3} />
          <Button variant="destructive" disabled={pending} onClick={() => decide(false)}>Reject</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CancelButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm("Cancel this leave?")) return;
        start(async () => {
          const r = await cancelLeaveAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      Cancel
    </Button>
  );
}
