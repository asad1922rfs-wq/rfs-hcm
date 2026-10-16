"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required errors={fe?.currentPassword} />
      <Field
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 8 characters, with letters and numbers."
        errors={fe?.newPassword}
      />
      <Field label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" required errors={fe?.confirmPassword} />
      <SubmitButton className="w-full">Save password</SubmitButton>
    </form>
  );
}
