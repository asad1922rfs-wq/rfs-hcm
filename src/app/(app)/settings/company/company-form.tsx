"use client";

import { useActionState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { updateCompanyAction } from "../actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Company = {
  legalName: string; shortName: string; address: string; phone: string; email: string; website: string; ntn: string;
  weekendDays: number[]; timezone: string; currency: string;
};

export function CompanyForm({ company }: { company: Company }) {
  const [state, action] = useActionState(updateCompanyAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-6">
      <FormMessage state={state} />
      <Card>
        <CardHeader><CardTitle>Company details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" name="legalName" defaultValue={company.legalName} required errors={fe?.legalName} className="sm:col-span-2" />
          <Field label="Short name" name="shortName" defaultValue={company.shortName} required errors={fe?.shortName} hint="Used in the sidebar, e.g. RFS" />
          <Field label="NTN" name="ntn" defaultValue={company.ntn} errors={fe?.ntn} />
          <Field label="Phone" name="phone" defaultValue={company.phone} errors={fe?.phone} />
          <Field label="Email" name="email" type="email" defaultValue={company.email} errors={fe?.email} />
          <Field label="Website" name="website" defaultValue={company.website} errors={fe?.website} />
          <Field label="Address" name="address" defaultValue={company.address} errors={fe?.address} className="sm:col-span-2" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Working week</CardTitle>
          <CardDescription>Weekly off days. Timezone: {company.timezone} · Currency: {company.currency}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {DAYS.map((day, i) => (
            <Label key={day} className="flex items-center gap-2 font-normal">
              <Checkbox name="weekendDays" value={String(i)} defaultChecked={company.weekendDays.includes(i)} />
              {day}
            </Label>
          ))}
        </CardContent>
      </Card>
      <div className="flex justify-end"><SubmitButton>Save settings</SubmitButton></div>
    </form>
  );
}
