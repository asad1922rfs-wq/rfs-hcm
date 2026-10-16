"use client";

import { createContext, useContext, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

// Salary and pay figures are personal: hidden until the viewer clicks the eye. Never remembered between visits.

const MASK = "Rs ••••••";
const GroupContext = createContext<{ shown: boolean; toggle: () => void } | null>(null);

/** Shares one show/hide state across every amount inside it (e.g. a whole payroll table). */
export function PrivacyGroup({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return <GroupContext.Provider value={{ shown, toggle: () => setShown((s) => !s) }}>{children}</GroupContext.Provider>;
}

/** The eye button for the surrounding PrivacyGroup. */
export function PrivacyToggle({ className }: { className?: string }) {
  const group = useContext(GroupContext);
  if (!group) return null;
  return (
    <button
      type="button"
      onClick={group.toggle}
      className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted", className)}
      aria-pressed={group.shown}
    >
      {group.shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {group.shown ? "Hide amounts" : "Show amounts"}
    </button>
  );
}

/** A money value: masked until revealed. Inside a PrivacyGroup it follows the group; alone it has its own eye. */
export function PrivateAmount({ value, className }: { value: string; className?: string }) {
  const group = useContext(GroupContext);
  const [ownShown, setOwnShown] = useState(false);
  const shown = group ? group.shown : ownShown;

  if (group) return <span className={cn("tabular-nums", className)}>{shown ? value : MASK}</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="tabular-nums">{shown ? value : MASK}</span>
      <button
        type="button"
        onClick={() => setOwnShown((s) => !s)}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={shown ? "Hide amount" : "Show amount"}
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}
