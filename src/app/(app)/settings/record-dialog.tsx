"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import type { ActionResult } from "@/server/errors";

export type DialogField =
  | { kind: "text"; name: string; label: string; required?: boolean; type?: string; hint?: string; defaultValue?: string; min?: number; max?: number }
  | { kind: "checkbox"; name: string; label: string; defaultChecked?: boolean }
  | { kind: "select"; name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string };

/** Create/edit dialog for simple settings records. Closes itself after a successful save. */
export function RecordDialog({
  title, description, trigger, triggerVariant = "outline", action, fields, id,
}: {
  title: string;
  description?: string;
  trigger: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  fields: DialogField[];
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>{trigger}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form action={formAction} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          {id && <input type="hidden" name="id" value={id} />}
          {fields.map((f) =>
            f.kind === "select" ? (
              <Field key={f.name} label={f.label} name={f.name} errors={fe?.[f.name]}>
                <NativeSelect id={`f-${f.name}`} name={f.name} defaultValue={f.defaultValue}>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
              </Field>
            ) : f.kind === "checkbox" ? (
              <Label key={f.name} className="flex items-center gap-2 font-normal">
                <Checkbox name={f.name} defaultChecked={f.defaultChecked} />
                {f.label}
              </Label>
            ) : (
              <Field
                key={f.name}
                label={f.label}
                name={f.name}
                type={f.type}
                required={f.required}
                hint={f.hint}
                defaultValue={f.defaultValue}
                min={f.min}
                max={f.max}
                errors={fe?.[f.name]}
              />
            ),
          )}
          <SubmitButton>Save</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
