"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage } from "@/components/form";
import { AdjustmentFields } from "./adjustment-fields";
import type { RegisterRow } from "@/server/services/attendance-edit";
import { saveAdjustmentAction } from "./edit-actions";

export function AdjustDialog({ row, today }: { row: RegisterRow; today?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState(saveAdjustmentAction.bind(null, row.employeeId), null);
  const [date, setDate] = useState(row.date);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      setOpen(false);
    }
  }, [state]);

  // Submitted manually so React does not clear the typed times when the server rejects them.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setDate(row.date); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Edit attendance for ${row.fullName} on ${row.date}`}><Pencil className="size-3.5" /> Edit</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit attendance · {row.fullName}</DialogTitle>
          <DialogDescription>
            {date && new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
            {" · "}shift {row.shiftLabel}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          <Field label="Date" name="date" type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          <AdjustmentFields
            errors={fe}
            defaults={row.adjustment ? { checkIn: row.adjustment.checkIn, checkOut: row.adjustment.checkOut, reason: row.adjustment.reason, category: row.adjustment.category, excused: row.adjustment.excused } : undefined}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
