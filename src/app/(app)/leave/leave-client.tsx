"use client";

import { createContext, type ReactNode, useActionState, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { bulkDecideLeaveAction, cancelLeaveAction, decideLeaveAction, requestLeaveAction } from "./actions";

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

type Selection = { ids: string[]; selected: Set<string>; toggle: (id: string, on: boolean) => void; setAll: (on: boolean) => void };
const SelectionContext = createContext<Selection | null>(null);
const useSelection = () => {
  const s = useContext(SelectionContext);
  if (!s) throw new Error("BulkDecide components must be inside <BulkDecideProvider>.");
  return s;
};

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
      const r = await bulkDecideLeaveAction([...selected], decision, decision === "REJECT" ? note : "");
      if (!r.ok) {
        toast.error(r.fieldErrors ? Object.values(r.fieldErrors).flat()[0] ?? r.error : r.error);
        return;
      }
      const { decided, skipped } = r.data ?? { decided: 0, skipped: [] };
      const head = `${decision === "APPROVE" ? "Approved" : "Rejected"} ${decided}`;
      const text = skipped.length
        ? `${head} · ${skipped.length} skipped: ${skipped.map((s) => `${s.name} ${s.dates} — ${s.reason}`).join("; ")}`
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
                <DialogDescription>Each request is checked on its own; any that can’t be approved (not eligible, payroll locked, out of your scope) are skipped and listed.</DialogDescription>
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
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" rows={3} maxLength={300} />
              <Button variant="destructive" disabled={pending} onClick={() => run("REJECT")}>
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
