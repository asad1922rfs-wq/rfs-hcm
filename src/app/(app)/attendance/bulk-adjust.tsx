"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormMessage } from "@/components/form";
import { AdjustmentFields } from "./adjustment-fields";
import { bulkAdjustmentAction } from "./edit-actions";

/** Appears above the daily register when employees are selected. */
export function BulkAdjustBar({ date, employees, onClear }: { date: string; employees: { id: string; name: string }[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(bulkAdjustmentAction.bind(null, employees.map((e) => e.id), date), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (!state?.ok) return;
    const skipped = state.data?.skipped ?? [];
    toast.success(state.message, skipped.length ? { description: `${skipped.length} skipped: ${skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}` } : undefined);
    setOpen(false);
    onClear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per completed submission
  }, [state]);

  if (employees.length === 0) return null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm">
      <span><strong>{employees.length}</strong> selected</span>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm"><Users className="size-4" /> Bulk edit selected</Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk edit · {employees.length} employee{employees.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              {new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}.
              The same times apply to everyone selected; machine punches are never changed and every change is logged per employee.
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
            <AdjustmentFields bulk errors={fe} defaults={{ category: "LOAD_SHEDDING", excused: true }} />
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />} Apply to {employees.length} employee{employees.length === 1 ? "" : "s"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
