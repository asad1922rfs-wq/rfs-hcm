"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import { Loader2, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage } from "@/components/form";
import type { RegisterRow } from "@/server/services/attendance-edit";
import { to12h } from "@/lib/format";
import { removeAdjustmentAction, saveAdjustmentAction } from "./edit-actions";

const show = (t: { time: string; nextDay: boolean } | null) => (t ? `${to12h(t.time)}${t.nextDay ? " (next day)" : ""}` : "—");

export function AdjustDialog({ row }: { row: RegisterRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, saving] = useActionState(saveAdjustmentAction.bind(null, row.employeeId, row.date), null);
  const [reverting, startRevert] = useTransition();
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Edit attendance for ${row.fullName} on ${row.date}`}><Pencil className="size-3.5" /> Edit</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit attendance · {row.fullName}</DialogTitle>
          <DialogDescription>
            {new Date(`${row.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
            {" · "}shift {row.shiftLabel}. Machine punches are never changed; your times are used instead and recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-1 rounded-md bg-muted px-3 py-2 text-xs">
          <div><dt className="inline font-medium">Machine punches: </dt><dd className="inline">{row.machinePunches.length ? row.machinePunches.map(show).join(", ") : "none"}</dd></div>
          <div><dt className="inline font-medium">Currently counted: </dt><dd className="inline">in {show(row.checkIn)}, out {show(row.checkOut)}</dd></div>
          {row.adjustment && (
            <div><dt className="inline font-medium">Manual change: </dt><dd className="inline">“{row.adjustment.reason}”</dd></div>
          )}
        </dl>
        <form onSubmit={onSubmit} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Check-in" name="checkIn" type="time" defaultValue={row.adjustment?.checkIn ?? ""} errors={fe?.checkIn} hint="Empty = keep the machine's" />
            <Field label="Check-out" name="checkOut" type="time" defaultValue={row.adjustment?.checkOut ?? ""} errors={fe?.checkOut} hint="Earlier than check-in = next day" />
          </div>
          <Field label="Reason" name="reason" required defaultValue={row.adjustment?.reason ?? ""} errors={fe?.reason} placeholder="e.g. Forgot to punch in; confirmed by manager" />
          <div className="flex flex-wrap justify-between gap-2">
            {row.adjustment ? (
              <Button
                type="button"
                variant="ghost"
                disabled={reverting}
                onClick={() =>
                  startRevert(async () => {
                    const r = await removeAdjustmentAction(row.employeeId, row.date);
                    if (r.ok) {
                      toast.success(r.message);
                      setOpen(false);
                    } else toast.error(r.error);
                  })
                }
              >
                <RotateCcw className="size-4" /> Revert to machine
              </Button>
            ) : <span />}
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
