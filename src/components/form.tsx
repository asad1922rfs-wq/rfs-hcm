"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/server/errors";

export function SubmitButton({ children, className, variant }: { children: React.ReactNode; className?: string; variant?: React.ComponentProps<typeof Button>["variant"] }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className={className} variant={variant}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}

type FieldProps = {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
  required?: boolean;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentProps<typeof Input>, "name">;

/** Label + input + error. Pass `children` to render a custom control instead of an <Input>. */
export function Field({ label, name, errors, hint, required, className, children, ...inputProps }: FieldProps) {
  const id = inputProps.id ?? `f-${name}`;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </Label>
      {children ?? <Input id={id} name={name} required={required} aria-invalid={errors?.length ? true : undefined} {...inputProps} />}
      {hint && !errors?.length && <p className="text-xs text-muted-foreground">{hint}</p>}
      <FieldError errors={errors} />
    </div>
  );
}

export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive",
        "dark:bg-input/30 [&>option]:bg-popover",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function FormMessage({ state }: { state: ActionResult<unknown> | null }) {
  if (!state) return null;
  if (state.ok) return state.message ? <Alert><AlertDescription>{state.message}</AlertDescription></Alert> : null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{state.error}</AlertDescription>
    </Alert>
  );
}
