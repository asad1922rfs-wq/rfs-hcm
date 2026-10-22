"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Field, FieldError, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { MAX_WAIVER_NOTE, MONTHLY_WAIVER_LIMIT, WAIVER_REASONS } from "@/core/attendance/waiver";
import { cancelLateWaiverAction, decideLateWaiverAction, requestLateWaiverAction } from "./actions";

/** `left`: requests still available per open month ("YYYY-MM"). `min`/`max`: the dates that can be chosen. */
export function RequestWaiverDialog({ left, min, max, defaultOpen }: { left: Record<string, number>; min: string; max: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [date, setDate] = useState(max);
  const [note, setNote] = useState("");
  const [state, action] = useActionState(requestLateWaiverAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const monthLeft = left[date.slice(0, 7)];
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setOpen(false);
      setNote("");
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Attendance request</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attendance request</DialogTitle>
          <DialogDescription>
            Ask for a late arrival to be waived. It is approved only if you worked your full shift that day (first check-in to last check-out).
          </DialogDescription>
        </DialogHeader>
        {Object.keys(left).length === 0 ? (
          <p className="text-sm text-muted-foreground">Payroll for this month is already approved, so no requests can be made right now.</p>
        ) : (
          <form action={action} className="grid gap-4">
            {state && !state.ok && <FormMessage state={state} />}
            <Field
              label="Date" name="date" type="date" required min={min} max={max} value={date} onChange={(e) => setDate(e.target.value)} errors={fe?.date}
              hint={monthLeft !== undefined ? `${monthLeft} of ${MONTHLY_WAIVER_LIMIT} left this month` : "This month's payroll is closed."}
            />
            <Field label="Reason" name="reasonKey" errors={fe?.reasonKey} required>
              <NativeSelect id="f-reasonKey" name="reasonKey" defaultValue={WAIVER_REASONS[0].key}>
                {WAIVER_REASONS.map((r) => <option key={r.key} value={r.key}>{r.text}</option>)}
              </NativeSelect>
            </Field>
            <div className="grid gap-1.5">
              <Label htmlFor="f-note">Note (optional)</Label>
              <Textarea id="f-note" name="note" rows={3} maxLength={MAX_WAIVER_NOTE} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything your manager should know" />
              <p className="text-right text-xs text-muted-foreground">{note.length}/{MAX_WAIVER_NOTE}</p>
              <FieldError errors={fe?.note} />
            </div>
            <SubmitButton>{monthLeft === 0 ? "No requests left this month" : "Send request"}</SubmitButton>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DecideWaiverButtons({ id, name, blockedReason }: { id: string; name: string; blockedReason: string | null }) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const decide = (approve: boolean) =>
    start(async () => {
      const r = await decideLateWaiverAction(id, approve, note);
      if (r.ok) {
        toast.success(r.message);
        setOpen(false);
      } else toast.error(r.error);
    });
  return (
    <div className="flex justify-end gap-1">
      <Button
        size="sm" disabled={pending} onClick={() => (blockedReason ? toast.error(blockedReason) : decide(true))}
        aria-label={`Approve attendance request for ${name}`} title={blockedReason ?? undefined} variant={blockedReason ? "secondary" : "default"}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild><Button size="sm" variant="outline" aria-label={`Reject attendance request for ${name}`}><X className="size-3.5" /> Reject</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject attendance request · {name}</DialogTitle>
            <DialogDescription>The employee will see your note.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" rows={3} maxLength={1000} />
          <Button variant="destructive" disabled={pending || note.trim().length < 3} onClick={() => decide(false)}>Reject</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CancelWaiverButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm("Cancel this request?")) return;
        start(async () => {
          const r = await cancelLateWaiverAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      Cancel
    </Button>
  );
}
