"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, NativeSelect, SubmitButton } from "@/components/form";
import { RowEditor } from "@/components/row-editor";
import { humanize } from "@/components/common";
import { formatMinuteOfDay } from "@/lib/format";
import { EMPLOYMENT_TYPES, GENDERS, NEW_DESIGNATION, WORK_MODES } from "@/lib/validation";
import { WORK_MODE_LABELS } from "@/core/attendance/web-punch";
import type { ActionResult } from "@/server/errors";

export type EmployeeFormOptions = {
  departments: { id: string; name: string }[];
  designations: { id: string; title: string }[];
  shifts: { id: string; name: string; startMinute: number; endMinute: number; isDefault: boolean }[];
  managers: { id: string; fullName: string; employeeCode: string }[];
};

export type EmployeeFormDefaults = Partial<Record<
  | "employeeCode" | "fullName" | "email" | "phone" | "gender" | "dateOfBirth" | "cnic" | "address" | "joiningDate"
  | "employmentType" | "departmentId" | "designationId" | "shiftId" | "managerId" | "deviceUserId" | "workMode" | "flexibleFrom",
  string
>> & { contacts?: { name: string; relationship: string; phone: string }[] };

type Props = {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  options: EmployeeFormOptions;
  defaults: EmployeeFormDefaults;
  mode: "create" | "edit";
  excludeManagerId?: string;
  canSetSalary?: boolean;
  canSetBank?: boolean;
  cancelHref: string;
};

export function EmployeeForm({ action, options, defaults, mode, excludeManagerId, canSetSalary, canSetBank, cancelHref }: Props) {
  const [state, formAction] = useActionState(action, null);
  const [newDesignation, setNewDesignation] = useState(false);
  const [workMode, setWorkMode] = useState(defaults.workMode ?? "OFFICE");
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const defaultShift = defaults.shiftId ?? options.shifts.find((s) => s.isDefault)?.id ?? "";

  return (
    <form action={formAction} className="grid gap-6">
      <FormMessage state={state} />

      <Card>
        <CardHeader>
          <CardTitle>Personal details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee ID" name="employeeCode" defaultValue={defaults.employeeCode} required errors={fe.employeeCode} hint="e.g. RFS-0001" />
          <Field label="Full name" name="fullName" defaultValue={defaults.fullName} required errors={fe.fullName} autoComplete="off" />
          <Field label="Email" name="email" type="email" defaultValue={defaults.email} errors={fe.email} hint="Work email — can be used to sign in" />
          <Field label="Phone" name="phone" type="tel" defaultValue={defaults.phone} errors={fe.phone} placeholder="03xx-xxxxxxx" />
          <Field label="Gender" name="gender" errors={fe.gender}>
            <NativeSelect id="f-gender" name="gender" defaultValue={defaults.gender ?? ""}>
              <option value="">Not specified</option>
              {GENDERS.map((g) => <option key={g} value={g}>{humanize(g)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={defaults.dateOfBirth} errors={fe.dateOfBirth} />
          <Field label="CNIC" name="cnic" defaultValue={defaults.cnic} errors={fe.cnic} placeholder="12345-1234567-1" hint="Stored encrypted" />
          <Field label="Address" name="address" defaultValue={defaults.address} errors={fe.address} className="sm:col-span-2" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Joining date" name="joiningDate" type="date" defaultValue={defaults.joiningDate} required errors={fe.joiningDate} />
          <Field label="Employment type" name="employmentType" errors={fe.employmentType} required>
            <NativeSelect id="f-employmentType" name="employmentType" defaultValue={defaults.employmentType ?? "PERMANENT"}>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Department" name="departmentId" errors={fe.departmentId} hint={options.departments.length ? undefined : "Add departments under Administration"}>
            <NativeSelect id="f-departmentId" name="departmentId" defaultValue={defaults.departmentId ?? ""}>
              <option value="">—</option>
              {options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Designation" name="designationId" errors={fe.designationId}>
            <NativeSelect id="f-designationId" name="designationId" defaultValue={defaults.designationId ?? ""} onChange={(e) => setNewDesignation(e.target.value === NEW_DESIGNATION)}>
              <option value="">—</option>
              {options.designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              <option value={NEW_DESIGNATION}>+ Add new designation…</option>
            </NativeSelect>
          </Field>
          {newDesignation && (
            <Field label="New designation title" name="newDesignation" errors={fe.newDesignation} required maxLength={100} autoFocus hint="Added to Departments & titles if it is not there yet" />
          )}
          <Field label="Reporting manager" name="managerId" errors={fe.managerId}>
            <NativeSelect id="f-managerId" name="managerId" defaultValue={defaults.managerId ?? ""}>
              <option value="">—</option>
              {options.managers.filter((m) => m.id !== excludeManagerId).map((m) => (
                <option key={m.id} value={m.id}>{m.fullName} ({m.employeeCode})</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Shift" name="shiftId" errors={fe.shiftId}>
            <NativeSelect id="f-shiftId" name="shiftId" defaultValue={defaultShift}>
              <option value="">—</option>
              {options.shifts.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({formatMinuteOfDay(s.startMinute)} – {formatMinuteOfDay(s.endMinute)})</option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Biometric machine user ID"
            name="deviceUserId"
            defaultValue={defaults.deviceUserId}
            errors={fe.deviceUserId}
            hint="The user number enrolled on the ZKTeco device"
            inputMode="numeric"
          />
          <Field label="Work mode" name="workMode" errors={fe.workMode} required hint="Remote employees sign in and out from their dashboard">
            <NativeSelect id="f-workMode" name="workMode" value={workMode} onChange={(ev) => setWorkMode(ev.target.value)}>
              {WORK_MODES.map((m) => <option key={m} value={m}>{WORK_MODE_LABELS[m]}</option>)}
            </NativeSelect>
          </Field>
          {workMode === "REMOTE" && (
            <Field
              label="Flexible hours from"
              name="flexibleFrom"
              type="date"
              defaultValue={defaults.flexibleFrom}
              errors={fe.flexibleFrom}
              hint="From this date: no shift timing, 9 hours minimum a day. Earlier days are credited. Blank = tomorrow"
            />
          )}
        </CardContent>
      </Card>

      {mode === "create" && canSetSalary && (
        <Card>
          <CardHeader>
            <CardTitle>Salary</CardTitle>
            <CardDescription>Effective from the joining date. Later revisions are added from the employee profile.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Field label="Monthly basic salary (PKR)" name="basicSalary" type="number" min={0} step="0.01" inputMode="decimal" errors={fe.basicSalary} className="sm:max-w-xs" />
            <div>
              <p className="mb-2 text-sm font-medium">Fixed monthly allowances</p>
              <RowEditor
                prefix="allowances"
                addLabel="Add allowance"
                columns={[
                  { key: "name", label: "Allowance", placeholder: "e.g. Fuel" },
                  { key: "amount", label: "Amount (PKR)", type: "number", inputMode: "decimal" },
                ]}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "create" && canSetBank && (
        <Card>
          <CardHeader>
            <CardTitle>Bank details</CardTitle>
            <CardDescription>Optional. Account number and IBAN are stored encrypted and only visible to authorised roles.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name" name="bankName" errors={fe.bankName} />
            <Field label="Branch" name="branch" errors={fe.branch} />
            <Field label="Account title" name="accountTitle" errors={fe.accountTitle} />
            <Field label="Account number" name="accountNumber" errors={fe.accountNumber} autoComplete="off" />
            <Field label="IBAN" name="iban" errors={fe.iban} placeholder="PK36SCBL0000001123456702" autoComplete="off" className="sm:col-span-2" />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Emergency contacts</CardTitle>
        </CardHeader>
        <CardContent>
          <RowEditor
            prefix="contacts"
            addLabel="Add contact"
            max={5}
            initial={defaults.contacts}
            columns={[
              { key: "name", label: "Name" },
              { key: "relationship", label: "Relationship", placeholder: "e.g. Father" },
              { key: "phone", label: "Phone", type: "tel" },
            ]}
          />
          {Object.keys(fe).some((k) => k.startsWith("contacts") || /^\d/.test(k)) && (
            <p className="mt-2 text-xs text-destructive">Check the emergency contact rows — name, relationship and a valid phone are required.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost"><Link href={cancelHref}>Cancel</Link></Button>
        <SubmitButton>{mode === "create" ? "Create employee" : "Save changes"}</SubmitButton>
      </div>
    </form>
  );
}
