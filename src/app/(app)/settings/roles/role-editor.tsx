"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { updateRoleAction } from "../actions";

export type PermissionRow = { key: string; label: string; group: string; scopes: readonly string[] };

const SCOPE_LABEL: Record<string, string> = { self: "Own records", team: "Their team", department: "Their department", all: "Everyone" };

export function RoleEditor({
  role, permissions, readOnly,
}: {
  role: { id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean; userCount: number };
  permissions: PermissionRow[];
  readOnly: boolean;
}) {
  const [state, action] = useActionState(updateRoleAction.bind(null, role.id), null);
  const granted = new Map(role.permissions.map((g) => g.split(":") as [string, string]));
  const groups = [...new Set(permissions.map((p) => p.group))];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{role.name}</CardTitle>
        <CardDescription>
          {role.description} · {role.userCount} user{role.userCount === 1 ? "" : "s"}
          {readOnly && " · Full access, cannot be edited"}
        </CardDescription>
      </CardHeader>
      {!readOnly && (
        <CardContent>
          <form action={action} className="grid gap-6">
            <FormMessage state={state} />
            {groups.map((group) => (
              <fieldset key={group}>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</legend>
                <div className="grid gap-2">
                  {permissions.filter((p) => p.group === group).map((p) => {
                    const current = granted.get(p.key);
                    return (
                      <label key={p.key} className="grid items-center gap-2 sm:grid-cols-[1fr_200px]">
                        <span className="text-sm">{p.label}</span>
                        <NativeSelect name="grants" defaultValue={current ? `${p.key}:${current}` : ""} aria-label={p.label}>
                          <option value="">No access</option>
                          {p.scopes.map((s) => <option key={s} value={`${p.key}:${s}`}>{SCOPE_LABEL[s]}</option>)}
                        </NativeSelect>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap justify-end gap-2">
              {role.isSystem && (
                <Button type="submit" name="$reset" value="1" variant="ghost">Restore defaults</Button>
              )}
              <SubmitButton>Save permissions</SubmitButton>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
