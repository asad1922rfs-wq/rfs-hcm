"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteHolidayAction, loadPakistanHolidaysAction } from "./actions";

export function DeleteHolidayButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove the holiday "${label}"? That day becomes a working day again and attendance will be recalculated.`)) return;
        start(async () => {
          const r = await deleteHolidayAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      Remove
    </Button>
  );
}

export function LoadPakistanHolidaysButton({ year }: { year: number }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await loadPakistanHolidaysAction(year);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      Load Pakistan public holidays for {year}
    </Button>
  );
}
