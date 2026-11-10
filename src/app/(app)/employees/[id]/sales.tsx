"use client";

import { useActionState, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { EmptyState } from "@/components/common";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";
import { formatPKR, formatUSD } from "@/lib/format";
import { commissionFor, commissionPercent, DEFAULT_USD_RATE } from "@/core/sales/commission";
import { deleteSalesMonthAction, saveSalesMonthAction } from "../actions";
import { ConfirmDeleteButton } from "./panels";

export type SalesMonthRow = {
  id: string;
  year: number;
  month: number;
  target: number;
  achieved: number;
  commission: number;
  percent: number | null;
  note: string | null;
  locked: boolean;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymOf = (r: { year: number; month: number }) => `${r.year}-${String(r.month).padStart(2, "0")}`;
const LOCKED = "Payroll for this month is approved or paid, so it can no longer be changed.";

function SalesMonthDialog({ employeeId, row, defaultMonth }: { employeeId: string; row?: SalesMonthRow; defaultMonth: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveSalesMonthAction.bind(null, employeeId, row?.id ?? null), null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const [achieved, setAchieved] = useState(row ? String(row.achieved) : "");
  const [rate, setRate] = useState(String(DEFAULT_USD_RATE));
  const [commission, setCommission] = useState(row ? String(row.commission) : "");
  const recalc = (a: string, r: string) => {
    setAchieved(a);
    setRate(r);
    if (Number(a) > 0 && Number(r) > 0) setCommission(String(commissionFor(Number(a), Number(r))));
  };
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Sales figures saved.");
      setOpen(false);
    }
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {row ? (
          <Button variant="ghost" size="icon" aria-label="Edit month" disabled={row.locked} title={row.locked ? LOCKED : "Edit month"}><Pencil className="size-4" /></Button>
        ) : (
          <Button size="sm"><Plus className="size-4" /> Add month</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row ? "Edit sales month" : "Add sales month"}</DialogTitle>
          <DialogDescription>
            The commission is paid as an earning in that month&apos;s payroll. Draft payroll is not recalculated automatically: use Recalculate on the payroll page afterwards.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <FormMessage state={state && !state.ok ? state : null} />
          <Field label="Month" name="month" type="month" defaultValue={row ? ymOf(row) : defaultMonth} required errors={fe?.month} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Target (USD)" name="target" type="number" min={0} step="0.01" defaultValue={row?.target ?? ""} required errors={fe?.target} />
            <Field label="Achieved (USD)" name="achieved" type="number" min={0} step="0.01" value={achieved} onChange={(e) => recalc(e.target.value, rate)} required errors={fe?.achieved} />
            <Field label="Dollar rate (PKR per $)" name="rate" type="number" min={0} step="0.01" value={rate} onChange={(e) => recalc(achieved, e.target.value)} />
            <Field label="Commission (PKR)" name="commission" type="number" min={0} step="0.01" value={commission} onChange={(e) => setCommission(e.target.value)} required errors={fe?.commission} />
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {Number(achieved) > 0 && Number(rate) > 0
              ? `${commissionPercent(Number(achieved))}% of ${formatPKR(Number(achieved) * Number(rate))} (slab: up to $5,000 0% · $8,000 3% · $10,500 5% · $12,500 7% · above 10%). You can change the commission if needed.`
              : "Commission fills in automatically from achieved sales and the dollar rate."}
          </p>
          <Field label="Note" name="note" defaultValue={row?.note ?? ""} errors={fe?.note} />
          <SubmitButton>Save</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SalesPanel({ employeeId, rows, canManage, defaultMonth }: { employeeId: string; rows: SalesMonthRow[]; canManage: boolean; defaultMonth: string }) {
  return (
    <PrivacyGroup>
      <div className="grid gap-4">
        <div className="flex items-center justify-end gap-2">
          <PrivacyToggle />
          {canManage && <SalesMonthDialog employeeId={employeeId} defaultMonth={defaultMonth} />}
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No sales months yet" description={canManage ? "Add a month's target, achieved sales and commission." : undefined} />
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Target</TableHead>
                  <TableHead className="text-right">Achieved</TableHead>
                  <TableHead className="text-right">% of target</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="hidden sm:table-cell">Note</TableHead>
                  {canManage && <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{MONTHS[r.month - 1]} {r.year}</TableCell>
                    <TableCell className="text-right tabular-nums"><PrivateAmount value={formatUSD(r.target)} /></TableCell>
                    <TableCell className="text-right tabular-nums"><PrivateAmount value={formatUSD(r.achieved)} /></TableCell>
                    <TableCell className="text-right tabular-nums">{r.percent === null ? "—" : `${r.percent}%`}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums"><PrivateAmount value={formatPKR(r.commission)} /></TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{r.note ?? "—"}</TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex justify-end">
                          <SalesMonthDialog employeeId={employeeId} row={r} defaultMonth={defaultMonth} />
                          <ConfirmDeleteButton
                            title="Delete sales month"
                            description="Its commission will no longer be paid in that month's payroll (recalculate a draft payroll afterwards). This is recorded in the audit log."
                            disabledReason={r.locked ? LOCKED : null}
                            onDelete={() => deleteSalesMonthAction(employeeId, r.id)}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </PrivacyGroup>
  );
}
