"use client";

import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage, SubmitButton } from "@/components/form";
import { importPunchesAction } from "./actions";

export function ImportForm() {
  const [state, action] = useActionState(importPunchesAction, null);
  const result = state?.ok ? state.data : undefined;
  return (
    <form action={action} className="grid gap-4">
      {state && !state.ok && <FormMessage state={state} />}
      {result && (
        <div className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-success" /> Imported {result.fileName}</p>
          <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
            <li>Rows read: <strong className="text-foreground">{result.rowsRead}</strong></li>
            <li>New punches saved: <strong className="text-foreground">{result.inserted}</strong></li>
            <li>Already imported (skipped): <strong className="text-foreground">{result.duplicates}</strong></li>
            <li>Invalid rows: <strong className="text-foreground">{result.invalid}</strong></li>
          </ul>
          {result.unmatchedIds.length > 0 && (
            <p className="mt-2">
              Device user IDs not linked to any employee: <strong>{result.unmatchedIds.slice(0, 20).join(", ")}</strong>
              {result.unmatchedIds.length > 20 && " …"}. Set the <em>Biometric machine user ID</em> on those employees — their punches attach automatically.
            </p>
          )}
          {result.errors.length > 0 && (
            <details className="mt-2"><summary className="cursor-pointer">Problems found</summary>
              <ul className="mt-1 list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </details>
          )}
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="file">Attendance log file</Label>
        <Input id="file" name="file" type="file" accept=".dat,.txt,.csv,.tsv" required />
        <p className="text-xs text-muted-foreground">
          ZKTeco USB download (<code>attlog.dat</code> / <code>1_attlog.dat</code>), or a CSV/text export with user ID and date/time columns.
          Importing the same file twice is safe — duplicates are skipped.
        </p>
      </div>
      <SubmitButton className="w-fit">Import punches</SubmitButton>
    </form>
  );
}
