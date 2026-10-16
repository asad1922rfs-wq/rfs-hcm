"use client";

import { startTransition, useActionState, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormMessage } from "@/components/form";
import { formatPKR } from "@/lib/format";
import { salaryImportAction } from "./actions";

export function SalaryImport() {
  const [state, action, pending] = useActionState(salaryImportAction, null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const data = state?.ok ? state.data : undefined;
  const rows = data?.rows ?? [];
  const isEmpty = (r: (typeof rows)[number]) => r.basicSalary === null && r.errors.length === 1 && r.errors[0]!.startsWith("No basic salary");
  const shown = hideEmpty ? rows.filter((r) => !isEmpty(r)) : rows;
  const toSave = rows.filter((r) => r.action !== "skip").length;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("intent", ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "preview");
    startTransition(() => action(fd));
  };

  return (
    <div className="grid gap-6">
      <div className="rounded-lg border bg-card p-4 text-sm">
        <p className="font-medium">1. Download the template</p>
        <p className="mt-1 text-muted-foreground">It lists every active employee. Fill in Basic Salary and add a column per allowance type, e.g. “Allowance: Fuel”.</p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <a href="/api/v1/salaries/template"><Download className="size-4" /> Download salary template</a>
        </Button>
      </div>

      <form onSubmit={onSubmit} className="grid gap-4 rounded-lg border bg-card p-4">
        <p className="text-sm font-medium">2. Upload the filled-in file</p>
        {state && !state.ok && <FormMessage state={state} />}
        {data?.mode === "done" && (
          <p className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
            <CheckCircle2 className="size-4 text-success" /> Saved {data.saved} salar{data.saved === 1 ? "y" : "ies"}.
          </p>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="file">Salary file (.xlsx)</Label>
          <Input id="file" name="file" type="file" accept=".xlsx" required />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Preview
          </Button>
          {data?.mode === "preview" && toSave > 0 && (
            <Button type="submit" name="intent" value="import" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />} Save {toSave} salar{toSave === 1 ? "y" : "ies"}
            </Button>
          )}
        </div>
      </form>

      {rows.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide rows without a salary entered
          </label>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead><TableHead>Effective from</TableHead>
                  <TableHead className="text-right">Basic</TableHead><TableHead className="hidden md:table-cell">Allowances</TableHead>
                  <TableHead className="text-right">Monthly gross</TableHead><TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => {
                  const gross = (r.basicSalary ?? 0) + r.allowances.reduce((s, a) => s + a.amount, 0);
                  return (
                    <TableRow key={r.rowNumber} className="align-top">
                      <TableCell>
                        <span className="block font-medium">{r.fullName ?? "—"}</span>
                        <span className="block text-xs text-muted-foreground">{r.employeeCode} · row {r.rowNumber}</span>
                        {r.errors.map((m) => <span key={m} className="mt-1 flex gap-1 text-xs text-destructive"><XCircle className="mt-0.5 size-3" />{m}</span>)}
                        {r.warnings.map((m) => <span key={m} className="mt-1 flex gap-1 text-xs"><AlertTriangle className="mt-0.5 size-3 text-warning" />{m}</span>)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{r.effectiveFrom ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.basicSalary !== null ? formatPKR(r.basicSalary) : "—"}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs">{r.allowances.map((a) => `${a.name} ${formatPKR(a.amount)}`).join(", ") || "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{r.basicSalary !== null ? formatPKR(gross) : "—"}</TableCell>
                      <TableCell>{r.action === "skip" ? <span className="text-destructive">Skip</span> : r.action === "replace" ? "Replace" : <span className="text-success">Add</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
