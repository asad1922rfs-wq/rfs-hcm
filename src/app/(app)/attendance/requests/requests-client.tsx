"use client";

import { createContext, type ReactNode, useActionState, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Field, FieldError, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { MAX_WAIVER_NOTE, MONTHLY_WAIVER_LIMIT, WAIVER_REASONS } from "@/core/attendance/waiver";
import { bulkDecideAction, cancelLateWaiverAction, decideLateWaiverAction, requestLateWaiverAction } from "./actions";

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
            “Full shift hours” and “Stayed late” are approved only if you worked your full shift that day. “Forgot to punch”, “Prior permission” and “Half day” are up to your approver — once approved, that day has no deduction.
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

type Selection = { ids: string[]; selected: Set<string>; toggle: (id: string, on: boolean) => void; setAll: (on: boolean) => void };
const SelectionContext = createContext<Selection | null>(null);
const useSelection = () => {
  const s = useContext(SelectionContext);
  if (!s) throw new Error("BulkDecide components must be inside <BulkDecideProvider>.");
  return s;
};

const shortDate = (iso: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)) : "";

/** Wraps the approvals table: tracks the ticked rows and shows the sticky bulk action bar. */
export function BulkDecideProvider({ ids, children }: { ids: string[]; children: ReactNode }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  // Drop selections for rows that are no longer in the list (decided elsewhere, refreshed).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ids]);

  const value = useMemo<Selection>(() => ({
    ids,
    selected,
    toggle: (id, on) => setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    }),
    setAll: (on) => setSelected(on ? new Set(ids) : new Set()),
  }), [ids, selected]);

  const run = (decision: "APPROVE" | "REJECT") =>
    start(async () => {
      const r = await bulkDecideAction([...selected], decision, decision === "REJECT" ? note : "");
      if (!r.ok) {
        toast.error(r.fieldErrors ? Object.values(r.fieldErrors).flat()[0] ?? r.error : r.error);
        return;
      }
      const { decided, skipped } = r.data ?? { decided: 0, skipped: [] };
      const head = `${decision === "APPROVE" ? "Approved" : "Rejected"} ${decided}`;
      const text = skipped.length
        ? `${head} · ${skipped.length} skipped: ${skipped.map((s) => `${s.name} ${shortDate(s.date)} — ${s.reason}`).join("; ")}`
        : head;
      if (skipped.length && !decided) toast.error(text);
      else if (skipped.length) toast.warning(text);
      else toast.success(text);
      setSelected(new Set());
      setConfirmOpen(false);
      setRejectOpen(false);
      setNote("");
      router.refresh();
    });

  const n = selected.size;
  const label = `${n} request${n === 1 ? "" : "s"}`;
  return (
    <SelectionContext.Provider value={value}>
      {children}
      {n > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto mt-4 flex w-fit flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2 shadow-lg" role="region" aria-label="Bulk actions">
          <span className="text-sm font-medium">{n} selected</span>
          <span className="text-muted-foreground">·</span>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger asChild><Button size="sm" disabled={pending}><Check className="size-3.5" /> Approve selected</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Approve {label}?</DialogTitle>
                <DialogDescription>Each request is checked on its own; any that can’t be approved (hours short, payroll locked) are skipped and listed.</DialogDescription>
              </DialogHeader>
              <Button disabled={pending} onClick={() => run("APPROVE")}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve {label}
              </Button>
            </DialogContent>
          </Dialog>
          <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
            <DialogTrigger asChild><Button size="sm" variant="outline" disabled={pending}><X className="size-3.5" /> Reject selected</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reject {label}?</DialogTitle>
                <DialogDescription>This note is sent to every selected employee.</DialogDescription>
              </DialogHeader>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (required)" rows={3} maxLength={1000} />
              <Button variant="destructive" disabled={pending || note.trim().length < 3} onClick={() => run("REJECT")}>
                {pending && <Loader2 className="size-3.5 animate-spin" />} Reject {label}
              </Button>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
    </SelectionContext.Provider>
  );
}

export function SelectAllCheckbox() {
  const { ids, selected, setAll } = useSelection();
  const all = ids.length > 0 && selected.size === ids.length;
  return <Checkbox aria-label="Select all requests" checked={all ? true : selected.size ? "indeterminate" : false} onCheckedChange={(c) => setAll(c === true)} />;
}

export function SelectRowCheckbox({ id, name }: { id: string; name: string }) {
  const { selected, toggle } = useSelection();
  return <Checkbox aria-label={`Select request for ${name}`} checked={selected.has(id)} onCheckedChange={(c) => toggle(id, c === true)} />;
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
