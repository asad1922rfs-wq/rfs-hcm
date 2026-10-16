"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { RowEditor } from "@/components/row-editor";
import { updateOwnProfileAction } from "../employees/actions";

export function SelfProfileForm({ phone, address, contacts }: { phone: string; address: string; contacts: { name: string; relationship: string; phone: string }[] }) {
  const [state, action] = useActionState(updateOwnProfileAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" name="phone" type="tel" defaultValue={phone} errors={fe?.phone} />
        <Field label="Address" name="address" defaultValue={address} errors={fe?.address} />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Emergency contacts</p>
        <RowEditor
          prefix="contacts"
          addLabel="Add contact"
          max={5}
          initial={contacts}
          columns={[
            { key: "name", label: "Name" },
            { key: "relationship", label: "Relationship" },
            { key: "phone", label: "Phone", type: "tel" },
          ]}
        />
      </div>
      <SubmitButton className="w-fit">Save</SubmitButton>
    </form>
  );
}
