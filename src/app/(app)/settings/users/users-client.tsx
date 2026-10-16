"use client";

import { useActionState, useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { createUserAction, resetPasswordAction, updateUserAction } from "../actions";

type Role = { id: string; name: string; key: string };

function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const base = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${base.slice(0, 10)}${(bytes[0]! % 8) + 2}`; // always contains a digit
}

function PasswordField({ errors }: { errors?: string[] }) {
  const [value, setValue] = useState("");
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="f-temporaryPassword">Temporary password <span className="text-destructive">*</span></Label>
      <div className="flex gap-2">
        <Input id="f-temporaryPassword" name="temporaryPassword" value={value} onChange={(e) => setValue(e.target.value)} required autoComplete="off" className="font-mono" />
        <Button type="button" variant="outline" size="icon" onClick={() => setValue(generatePassword())} aria-label="Generate password">
          <Wand2 className="size-4" />
        </Button>
      </div>
      <p className={errors?.length ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {errors?.[0] ?? "The user must change it at first sign-in."}
      </p>
    </div>
  );
}

function useCloseOnSuccess(state: { ok: boolean } | null) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  return [open, setOpen] as const;
}

export function CreateUserDialog({ employees, roles }: { employees: { id: string; fullName: string; employeeCode: string; email: string | null }[]; roles: Role[] }) {
  const [state, action] = useActionState(createUserAction, null);
  const [open, setOpen] = useCloseOnSuccess(state);
  const [employeeId, setEmployeeId] = useState("");
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  const selected = employees.find((e) => e.id === employeeId);
  const defaultRole = roles.find((r) => r.key === "EMPLOYEE")?.id ?? roles[0]?.id;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Create login</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create login</DialogTitle>
          <DialogDescription>Employees can sign in with their email or Employee ID.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          <Field label="Employee" name="employeeId">
            <NativeSelect id="f-employeeId" name="employeeId" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">— Not linked to an employee (admin account) —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</option>)}
            </NativeSelect>
          </Field>
          {!employeeId && <Field label="Name" name="displayName" required errors={fe?.displayName} />}
          <Field
            key={employeeId}
            label="Login email"
            name="email"
            type="email"
            defaultValue={selected?.email ?? ""}
            required={!employeeId}
            errors={fe?.email}
            hint={employeeId ? "Optional — they can also use their Employee ID" : undefined}
          />
          <Field label="Role" name="roleId">
            <NativeSelect id="f-roleId" name="roleId" defaultValue={defaultRole}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </NativeSelect>
          </Field>
          <PasswordField errors={fe?.temporaryPassword} />
          <SubmitButton>Create login</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({ user, roles }: { user: { id: string; displayName: string; isActive: boolean; roleId: string }; roles: Role[] }) {
  const [state, action] = useActionState(updateUserAction.bind(null, user.id), null);
  const [open, setOpen] = useCloseOnSuccess(state);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Edit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user.displayName}</DialogTitle>
          <DialogDescription>Changing the role or disabling the login signs the user out everywhere.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          <Field label="Role" name="roleId">
            <NativeSelect id="f-roleId-edit" name="roleId" defaultValue={user.roleId}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </NativeSelect>
          </Field>
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox name="isActive" defaultChecked={user.isActive} /> Login enabled
          </Label>
          <SubmitButton>Save</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ResetPasswordDialog({ user }: { user: { id: string; displayName: string } }) {
  const [state, action] = useActionState(resetPasswordAction.bind(null, user.id), null);
  const [open, setOpen] = useCloseOnSuccess(state);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Reset password</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password for {user.displayName}</DialogTitle>
          <DialogDescription>Signs the user out everywhere. They must choose a new password at next sign-in.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {state && !state.ok && <FormMessage state={state} />}
          <PasswordField errors={fe?.temporaryPassword} />
          <SubmitButton>Reset password</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
