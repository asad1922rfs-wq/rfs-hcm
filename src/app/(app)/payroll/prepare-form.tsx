"use client";

import { useActionState } from "react";
import { FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { prepareRunAction } from "./actions";

export function PrepareForm({ months }: { months: { value: string; label: string; exists: boolean }[] }) {
  const [state, action] = useActionState(prepareRunAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {state && !state.ok && <div className="w-full"><FormMessage state={state} /></div>}
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Month</span>
        <NativeSelect name="period" defaultValue={months.find((m) => !m.exists)?.value ?? months[0]?.value} className="w-56">
          {months.map((m) => <option key={m.value} value={m.value}>{m.label}{m.exists ? " (open)" : ""}</option>)}
        </NativeSelect>
      </label>
      <SubmitButton>Prepare payroll</SubmitButton>
    </form>
  );
}
