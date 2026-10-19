"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Field, NativeSelect } from "@/components/form";

const CATEGORIES = [
  { value: "OTHER", label: "Correction (forgot to punch, machine issue…)", excuse: false },
  { value: "WORK_FROM_HOME", label: "Work from home", excuse: true },
  { value: "LOAD_SHEDDING", label: "Load shedding / early off", excuse: true },
] as const;

/** Shared fields for single and bulk attendance edits. */
export function AdjustmentFields({
  defaults, errors,
}: {
  defaults?: { checkIn?: string | null; checkOut?: string | null; reason?: string; category?: string; excused?: boolean };
  errors?: Record<string, string[] | undefined>;

}) {
  const [category, setCategory] = useState(defaults?.category ?? "OTHER");
  const [excused, setExcused] = useState(defaults?.excused ?? false);

  return (
    <>
      <Field label="Type" name="category">
        <NativeSelect
          id="f-category"
          name="category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setExcused(CATEGORIES.find((c) => c.value === e.target.value)?.excuse ?? false);
          }}
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </NativeSelect>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Check-in" name="checkIn" type="time" defaultValue={defaults?.checkIn ?? ""} errors={errors?.checkIn} hint="Empty = machine's check-in" />
        <Field label="Check-out" name="checkOut" type="time" defaultValue={defaults?.checkOut ?? ""} errors={errors?.checkOut} hint="Empty = machine's check-out · 12:00 = midnight" />
      </div>
      <Label className="flex items-start gap-2 font-normal">
        <input type="checkbox" name="excused" checked={excused} onChange={(e) => setExcused(e.target.checked)} className="mt-0.5" />
        <span>
          Excuse the times I change
          <span className="block text-xs text-muted-foreground">A changed check-in is not late; a changed check-out is not early. Machine times still count (e.g. a late machine check-in stays Late). Leave both times empty to count the whole day as Present.</span>
        </span>
      </Label>
      <Field
        label="Reason"
        name="reason"
        required
        defaultValue={defaults?.reason ?? ""}
        errors={errors?.reason}
        placeholder={category === "LOAD_SHEDDING" ? "e.g. Office closed early — load shedding" : category === "WORK_FROM_HOME" ? "e.g. Work from home approved by director" : "e.g. Forgot to punch in; confirmed by manager"}
      />
    </>
  );
}
