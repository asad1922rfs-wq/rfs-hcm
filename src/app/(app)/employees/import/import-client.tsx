"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormMessage } from "@/components/form";
import { humanize } from "@/components/common";
import { employeeImportAction } from "./actions";

/** Submit button that posts `intent` and disables itself (and shows progress) while the form is submitting. */
function IntentButton({ intent, variant, pending, children }: { intent: string; variant?: "secondary"; pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" name="intent" value={intent} variant={variant} disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}

export function EmployeeImport() {
  const [state, action, pending] = useActionState(employeeImportAction, null);
  // Submitted manually (not via form action) so React does not reset the form and the chosen file
  // stays selected between Preview and Import.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    fd.set("intent", submitter?.value ?? "preview");
    startTransition(() => action(fd));
  };
  const [onlyIssues, setOnlyIssues] = useState(false);
  const data = state?.ok ? state.data : undefined;
  const rows = data?.rows ?? [];
  const shown = onlyIssues ? rows.filter((r) => r.warnings.length || r.errors.length) : rows;
  const counts = {
    create: rows.filter((r) => r.action === "create").length,
    update: rows.filter((r) => r.action === "update").length,
    skip: rows.filter((r) => r.action === "skip").length,
    warn: rows.filter((r) => r.warnings.length).length,
  };

  return (
    <div className="grid gap-6">
      <form onSubmit={onSubmit} className="grid gap-4 rounded-lg border bg-card p-4">
        {state && !state.ok && <FormMessage state={state} />}
        {data?.mode === "done" && (
          <div className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 text-success" />
            <p>
              Imported: <strong>{data.created}</strong> created, <strong>{data.updated}</strong> updated, <strong>{data.skipped}</strong> skipped.
              Machine punches were linked and attendance history recalculated.{" "}
              <Link href="/employees" className="font-medium text-primary hover:underline">View employees</Link>
            </p>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="file">FlowHCM employee export (.xlsx)</Label>
          <Input id="file" name="file" type="file" accept=".xlsx" required />
          <p className="text-xs text-muted-foreground">
            Nothing is saved until you press <strong>Import</strong>. Existing employees (same Employee Code) are updated.
            The template&apos;s Password column is ignored — logins are created separately with new passwords.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <IntentButton intent="preview" variant="secondary" pending={pending}>Preview</IntentButton>
          {data?.mode === "preview" && counts.create + counts.update > 0 && (
            <IntentButton intent="import" pending={pending}>
              Import {counts.create + counts.update} employee{counts.create + counts.update === 1 ? "" : "s"}
            </IntentButton>
          )}
        </div>
      </form>

      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span><strong>{counts.create}</strong> new</span>
            <span><strong>{counts.update}</strong> update</span>
            <span className="text-destructive"><strong>{counts.skip}</strong> skipped (errors)</span>
            <span className="text-warning"><strong>{counts.warn}</strong> with warnings</span>
            <label className="ml-auto flex items-center gap-2">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Show only rows with issues
            </label>
          </div>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden md:table-cell">Department / designation</TableHead>
                  <TableHead className="hidden lg:table-cell">Type</TableHead>
                  <TableHead className="hidden sm:table-cell">Joined</TableHead>
                  <TableHead className="hidden md:table-cell">Machine</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow key={r.rowNumber} className="align-top">
                    <TableCell className="text-muted-foreground">{r.rowNumber}</TableCell>
                    <TableCell>
                      <span className="block font-medium">{r.fullName || "—"}</span>
                      <span className="block text-xs text-muted-foreground">
                        {r.employeeCode} · {humanize(r.status)}{r.exitDate ? ` (exit ${r.exitDate})` : ""}
                      </span>
                      {[...r.errors.map((m) => ["e", m] as const), ...r.warnings.map((m) => ["w", m] as const)].map(([kind, m]) => (
                        <span key={m} className={`mt-1 flex items-start gap-1 text-xs ${kind === "e" ? "text-destructive" : "text-warning-foreground dark:text-warning"}`}>
                          {kind === "e" ? <XCircle className="mt-0.5 size-3 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />}
                          {m}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {r.department ?? "—"}<span className="block text-xs text-muted-foreground">{r.designation ?? "—"}</span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{humanize(r.employmentType)}</TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap">{r.joiningDate ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell text-xs">
                      {r.deviceUserId ? <>ID {r.deviceUserId}<span className="block text-muted-foreground">{r.punchCount} punches{r.lastPunch ? `, last ${r.lastPunch}` : ""}</span></> : "—"}
                    </TableCell>
                    <TableCell>
                      <span className={r.action === "skip" ? "text-destructive" : r.action === "create" ? "text-success" : "text-info"}>
                        {r.action === "skip" ? "Skip" : r.action === "create" ? "Create" : "Update"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
