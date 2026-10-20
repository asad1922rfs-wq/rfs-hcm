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
import { payslipLineLabel } from "@/core/payroll/payslip-labels";

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

function Stat({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: string; tone?: "bad" }) {
  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : ""}`}>{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function LineBox({ title, lines, total, className = "" }: { title: string; lines: ItemView["lines"]; total: number; className?: string }) {
  return (
    <section className={`flex flex-col ${className}`}>
      <h3 className="border-b bg-muted/60 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide">{title}</h3>
      <ul className="grid flex-1 content-start gap-2 px-3 py-3 text-sm">
        {lines.length === 0 && <li className="text-muted-foreground">None</li>}
        {lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3" title={l.label}>
            <span>{payslipLineLabel(l)}</span>
            <span className="shrink-0 tabular-nums text-primary"><PrivateAmount value={formatPKR(l.amount)} /></span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between border-t px-3 py-2 text-sm font-semibold">
        <span>Total {title.toLowerCase()}</span>
        <span className="tabular-nums"><PrivateAmount value={formatPKR(total)} /></span>
      </p>
    </section>
  );
}

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

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Days employed" value={`${item.employedDays} / ${item.daysInMonth}`} />
          <Stat label="Present" value={item.presentDays} />
          <Stat label="Absent" value={item.absentDays} tone={item.absentDays ? "bad" : undefined} />
          <Stat
            label="Late + missing punch"
            value={`${item.lateCount + item.missingPunchCount}`}
            note={`${item.lateCount} late · ${item.missingPunchCount} missing → ${item.lateDeductionDays} day${item.lateDeductionDays === 1 ? "" : "s"} cut`}
            tone={item.lateDeductionDays ? "bad" : undefined}
          />
          <Stat label="Monthly salary" value={<PrivateAmount value={formatPKR(item.grossSalary)} />} />
          <Stat label="Per-day rate" value={<PrivateAmount value={formatPKR(item.perDayRate, true)} />} />
          <Stat label="No machine data" value={`${item.notSyncedDays} day${item.notSyncedDays === 1 ? "" : "s"}`} />
        </div>

        {item.warnings.length > 0 && (
          <ul className="grid gap-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {item.warnings.map((w) => <li key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />{w}</li>)}
          </ul>
        )}

        <div className="grid overflow-hidden rounded-md border sm:grid-cols-2">
          <LineBox title="Earnings" lines={earnings} total={item.earnings} />
          <LineBox title="Deductions" lines={deductions} total={item.deductions} className="border-t sm:border-t-0 sm:border-l" />
        </div>
        <p className="flex items-center justify-between rounded-md bg-primary px-4 py-3 text-primary-foreground">
          <span className="text-sm font-medium uppercase tracking-wide">Net pay</span>
          <span className="text-xl font-semibold tabular-nums"><PrivateAmount value={formatPKR(item.netPay)} /></span>
        </p>
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
