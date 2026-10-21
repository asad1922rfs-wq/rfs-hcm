"use client";

import { useState } from "react";
import { Field, NativeSelect } from "@/components/form";
import { ruleForDate } from "@/core/attendance/engine";
import { formatMinuteOfDay } from "@/lib/format";
import type { ShiftOption } from "@/server/services/attendance-edit";

const CATEGORIES = [
  { value: "OTHER", label: "Correction (forgot to punch, machine issue…)", excuse: false },
  { value: "WORK_FROM_HOME", label: "Work from home", excuse: true },
  { value: "LOAD_SHEDDING", label: "Load shedding / early off", excuse: true },
] as const;

/** Shared fields for single and bulk attendance edits. */
export function AdjustmentFields({
  defaults, errors, date, shifts = [], usualShiftName,
}: {
  defaults?: { checkIn?: string | null; checkOut?: string | null; reason?: string; category?: string; excused?: boolean; shiftId?: string | null };
  errors?: Record<string, string[] | undefined>;
  /** Work date being edited: shift timings are shown as they apply on it (weekday overrides). */
  date?: string;
  shifts?: ShiftOption[];
  /** Single edit: the employee's own shift. Bulk edit leaves it out (each employee keeps their own). */
  usualShiftName?: string | null;
}) {
  const [category, setCategory] = useState(defaults?.category ?? "OTHER");
  const timing = (s: ShiftOption) => {
    const r = date ? ruleForDate(s, date) : s;
    return `${formatMinuteOfDay(r.startMinute)} – ${formatMinuteOfDay(r.endMinute)}`;
  };

  return (
    <>
      <Field label="Type" name="category">
        <NativeSelect
          id="f-category"
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </NativeSelect>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Check-in" name="checkIn" type="time" defaultValue={defaults?.checkIn ?? ""} errors={errors?.checkIn} hint="Empty = machine's check-in" />
        <Field label="Check-out" name="checkOut" type="time" defaultValue={defaults?.checkOut ?? ""} errors={errors?.checkOut} hint="Empty = machine's check-out · 12:00 = midnight" />
      </div>
      {shifts.length > 0 && (
        <Field label="Shift for this day" name="shiftId" errors={errors?.shiftId} hint="Late / early for this day only is judged against the chosen shift. Times are not filled in.">
          <NativeSelect id="f-shiftId" name="shiftId" defaultValue={defaults?.shiftId ?? ""}>
            <option value="">{usualShiftName === undefined ? "Each employee's usual shift" : `Employee's usual shift${usualShiftName ? ` (${usualShiftName})` : ""}`}</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} · {timing(s)}</option>)}
          </NativeSelect>
        </Field>
      )}
      {/* Work from home / load shedding excuse the changed times; a correction does not. */}
      <input type="hidden" name="excused" value={String(CATEGORIES.find((c) => c.value === category)?.excuse ?? false)} />
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
