"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { loginAction } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-8 grid gap-4">
      <FormMessage state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email or Employee ID" name="identifier" autoComplete="username" autoFocus required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <SubmitButton className="mt-2 w-full">Sign in</SubmitButton>
    </form>
  );
}
