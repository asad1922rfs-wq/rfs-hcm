"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import type { WorkClock } from "@/server/services/work-clock";

const time12 = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" });
const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.floor(minutes % 60)).padStart(2, "0")}m`;

/** Today's working time, counting up live from the sign-in until the sign-out. */
export function WorkClockPanel({ clock }: { clock: WorkClock }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock.signIn || clock.signOut) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [clock.signIn, clock.signOut]);

  const worked = clock.signIn ? Math.max(0, ((clock.signOut ? Date.parse(clock.signOut) : now) - Date.parse(clock.signIn)) / 60_000) : 0;
  const pct = Math.min(100, Math.round((worked / clock.shiftMinutes) * 100));
  const remaining = Math.max(0, clock.shiftMinutes - worked);

  return (
    <div className="mt-5 w-full rounded-lg border bg-muted/40 px-4 py-3 text-left">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
        <Timer className="size-3.5" /> Today&apos;s work hours
      </p>
      {!clock.signIn ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {clock.offDay ? `${clock.offDay} — no work scheduled` : `Not signed in yet · shift ${clock.shiftLabel}`}
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{hm(worked)}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground">
            <span>In {time12(clock.signIn)}{clock.signOut ? ` · Out ${time12(clock.signOut)}` : ""}</span>
            <span>{clock.signOut ? `${pct}% of shift` : remaining > 0 ? `${hm(remaining)} to go` : "Shift complete"}</span>
          </p>
        </>
      )}
    </div>
  );
}
