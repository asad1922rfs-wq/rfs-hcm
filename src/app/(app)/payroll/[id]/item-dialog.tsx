"use client";

import { useActionState, useEffect, useTransition } from "react";
import { AlertTriangle, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { formatPKR } from "@/lib/format";
import { addAdjustmentAction, removeAdjustmentAction } from "../actions";
import { PrivateAmount } from "@/components/private-amount";

export type ItemView = {
  id: string;
  employeeCode: string;
  fullName: string;
  department: string | null;
  designation: string | null;
  grossSalary: number;
  perDayRate: number;
  daysInMonth: number;
  employedDays: number;
  presentDays: number;
  absentDays: number;
  lateCount: number;
  missingPunchCount: number;
  lateDeductionDays: number;
  notSyncedDays: number;
  earnings: number;
  deductions: number;
  netPay: number;
  lines: { kind: "EARNING" | "DEDUCTION"; code: string; label: string; amount: number }[];
  warnings: string[];
  adjustments: { id: string; kind: "EARNING" | "DEDUCTION"; label: string; amount: number }[];
};

export function ItemDialog({ runId, item, editable, payslipReady }: { runId: string; item: ItemView; editable: boolean; payslipReady: boolean }) {
  const [state, action] = useActionState(addAdjustmentAction.bind(null, runId, item.id), null);
  const [removing, startRemove] = useTransition();
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
  }, [state]);

  const earnings = item.lines.filter((l) => l.kind === "EARNING");
  const deductions = item.lines.filter((l) => l.kind === "DEDUCTION");

  return (
    <Dialog>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Details</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item.fullName} <span className="font-normal text-muted-foreground">({item.employeeCode})</span></DialogTitle>
          <DialogDescription>{[item.designation, item.department].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-muted p-3 text-xs sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Employed days</dt><dd className="font-medium">{item.employedDays} / {item.daysInMonth}</dd></div>
          <div><dt className="text-muted-foreground">Present</dt><dd className="font-medium">{item.presentDays}</dd></div>
          <div><dt className="text-muted-foreground">Absent</dt><dd className="font-medium">{item.absentDays}</dd></div>
          <div><dt className="text-muted-foreground">Late + missing</dt><dd className="font-medium">{item.lateCount} + {item.missingPunchCount} → {item.lateDeductionDays} day(s)</dd></div>
          <div><dt className="text-muted-foreground">Monthly salary</dt><dd className="font-medium"><PrivateAmount value={formatPKR(item.grossSalary)} /></dd></div>
          <div><dt className="text-muted-foreground">Per-day rate</dt><dd className="font-medium"><PrivateAmount value={formatPKR(item.perDayRate, true)} /></dd></div>
          <div><dt className="text-muted-foreground">No machine data</dt><dd className="font-medium">{item.notSyncedDays} day(s)</dd></div>
        </dl>

        {item.warnings.length > 0 && (
          <ul className="grid gap-1 text-sm">
            {item.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />{w}</li>)}
          </ul>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Earnings</h3>
            <ul className="grid gap-1 text-sm">
              {earnings.map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular-nums"><PrivateAmount value={formatPKR(l.amount)} /></span></li>)}
              <li className="flex justify-between border-t pt-1 font-medium"><span>Total</span><span className="tabular-nums"><PrivateAmount value={formatPKR(item.earnings)} /></span></li>
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deductions</h3>
            <ul className="grid gap-1 text-sm">
              {deductions.length === 0 && <li className="text-muted-foreground">None</li>}
              {deductions.map((l, i) => <li key={i} className="flex justify-between gap-3"><span>{l.label}</span><span className="shrink-0 tabular-nums"><PrivateAmount value={formatPKR(l.amount)} /></span></li>)}
              <li className="flex justify-between border-t pt-1 font-medium"><span>Total</span><span className="tabular-nums"><PrivateAmount value={formatPKR(item.deductions)} /></span></li>
            </ul>
          </section>
        </div>
        <p className="flex justify-between rounded-md border px-3 py-2 text-base font-semibold"><span>Net pay</span><span className="tabular-nums"><PrivateAmount value={formatPKR(item.netPay)} /></span></p>
        {payslipReady && (
          <Button asChild variant="outline" className="w-fit"><a href={`/api/v1/payslips/${item.id}`} target="_blank" rel="noopener"><FileText className="size-4" /> Payslip PDF</a></Button>
        )}

        {(editable || item.adjustments.length > 0) && (
          <section className="grid gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Manual adjustments</h3>
            {item.adjustments.length > 0 && (
              <ul className="grid gap-1 text-sm">
                {item.adjustments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span>{a.kind === "EARNING" ? "+" : "−"} {a.label}</span>
                    <span className="flex items-center gap-1 tabular-nums">
                      <PrivateAmount value={formatPKR(a.amount)} />
                      {editable && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          aria-label={`Remove ${a.label}`}
                          disabled={removing}
                          onClick={() => startRemove(async () => {
                            const r = await removeAdjustmentAction(runId, a.id);
                            if (r.ok) toast.success(r.message);
                            else toast.error(r.error);
                          })}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {editable && (
              <form action={action} className="grid gap-3 sm:grid-cols-[140px_1fr_140px_auto] sm:items-end">
                {state && !state.ok && <div className="sm:col-span-4"><FormMessage state={state} /></div>}
                <Field label="Type" name="kind">
                  <NativeSelect id="f-kind" name="kind" defaultValue="EARNING">
                    <option value="EARNING">Add (earning)</option>
                    <option value="DEDUCTION">Deduct</option>
                  </NativeSelect>
                </Field>
                <Field label="Description" name="label" placeholder="e.g. Performance bonus, Advance recovery" errors={fe?.label} />
                <Field label="Amount (PKR)" name="amount" type="number" min={1} step="1" errors={fe?.amount} />
                <SubmitButton>Add</SubmitButton>
              </form>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
