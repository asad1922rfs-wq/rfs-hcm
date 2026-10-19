"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import { Loader2, RotateCcw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage } from "@/components/form";
import { AdjustmentFields } from "./adjustment-fields";
import { bulkAdjustmentAction, bulkRemoveAdjustmentAction } from "./edit-actions";

const longDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * "Bulk edit" button for the daily register. Applies to the selected employees, or to everyone listed when
 * nobody is selected. The date is chosen inside the dialog, starting from the register's date.
 */
export function BulkAdjustButton({
  date, today, employees, selectedCount, onDone,
}: {
  date: string;
  today: string;
  employees: { id: string; name: string }[];
  selectedCount: number;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetDate, setTargetDate] = useState(date);
  const ids = employees.map((e) => e.id);
  const [state, action, pending] = useActionState(bulkAdjustmentAction.bind(null, ids), null);
  const [removing, startRemove] = useTransition();
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const who = `${employees.length} employee${employees.length === 1 ? "" : "s"}`;

  useEffect(() => {
    if (!state?.ok) return;
    const skipped = state.data?.skipped ?? [];
    toast.success(state.message, skipped.length ? { description: `${skipped.length} skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` } : undefined);
    setOpen(false);
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per completed submission
  }, [state]);

  const removeChanges = () => {
    if (!window.confirm(`Remove the manual changes on ${longDate(targetDate)} for ${who}? Their machine times will apply again.`)) return;
    startRemove(async () => {
      const res = await bulkRemoveAdjustmentAction(ids, targetDate);
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
        onDone();
      } else toast.error(res.error);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setTargetDate(date); }}>
      <DialogTrigger asChild>
        <Button disabled={employees.length === 0}>
          <Users className="size-4" /> Bulk edit {selectedCount ? `(${selectedCount} selected)` : "(all listed)"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk edit · {who}</DialogTitle>
          <DialogDescription>
            The same change applies to everyone below.
          </DialogDescription>
        </DialogHeader>
        <p className="max-h-20 overflow-y-auto rounded-md bg-muted px-3 py-2 text-xs">{employees.map((e) => e.name).join(", ")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            startTransition(() => action(fd));
          }}
          className="grid gap-4"
        >
          {state && !state.ok && <FormMessage state={state} />}
          <Field label="Date" name="date" type="date" required max={today} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} errors={fe?.date} />
          <p className="-mt-2 rounded-md bg-primary/10 px-3 py-2 text-base font-semibold text-primary">{targetDate ? longDate(targetDate) : "Choose a date"}</p>
          <AdjustmentFields errors={fe} defaults={{ category: "LOAD_SHEDDING", excused: true }} />
          <Button type="submit" disabled={pending || removing || !targetDate}>
            {pending && <Loader2 className="size-4 animate-spin" />} Apply to {who}
          </Button>
          <Button type="button" variant="outline" onClick={removeChanges} disabled={pending || removing || !targetDate}>
            {removing ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Remove manual changes on this date
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
