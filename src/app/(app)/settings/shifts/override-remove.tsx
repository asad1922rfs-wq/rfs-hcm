"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { deleteShiftOverrideAction } from "../actions";

export function RemoveOverrideButton({ id, label }: { id: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={`Remove ${label} timing`}
      disabled={pending}
      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      onClick={() => {
        if (!confirm(`Remove the ${label} timing? ${label} will use the shift's normal hours, and attendance will be recalculated.`)) return;
        start(async () => {
          const r = await deleteShiftOverrideAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      <X className="size-3.5" />
    </button>
  );
}
