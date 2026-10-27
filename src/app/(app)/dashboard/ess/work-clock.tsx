"use client";

import { useEffect, useState, useTransition } from "react";
import { LogIn, LogOut, Timer } from "lucide-react";
import { toast } from "sonner";
import type { WorkClock } from "@/server/services/work-clock";
import { Button } from "@/components/ui/button";
import { webPunchAction } from "@/app/(app)/attendance/actions";

const time12 = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Karachi" });
const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.floor(minutes % 60)).padStart(2, "0")}m`;

/** Today's working time, counting up live from the sign-in until the sign-out. Remote employees sign in/out here. */
export function WorkClockPanel({ clock, canPunch = false }: { clock: WorkClock; canPunch?: boolean }) {
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
          {clock.offDay ? `${clock.offDay} — no work scheduled` : clock.flexible ? `Not signed in yet · ${clock.shiftLabel}` : `Not signed in yet · shift ${clock.shiftLabel}`}
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{hm(worked)}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${pct >= 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground">
            <span>In {time12(clock.signIn)}{clock.signOut ? ` · Out ${time12(clock.signOut)}` : ""}</span>
            <span>
              {clock.flexible
                ? clock.signOut ? `${pct}% of 9h minimum` : remaining > 0 ? `${hm(remaining)} to go · 9h minimum` : "9h minimum met"
                : clock.signOut ? `${pct}% of shift` : remaining > 0 ? `${hm(remaining)} to go` : "Shift complete"}
            </span>
          </p>
        </>
      )}
      {canPunch && (
        <WebPunchButton signedInAt={clock.signIn} signedOutAt={clock.signOut} minimumMinutes={clock.minimumApplies && !clock.offDay ? clock.shiftMinutes : null} />
      )}
    </div>
  );
}

/**
 * Every click records a punch at the server's time: the first of the day is the sign-in, the last the sign-out
 * (so signing out again after a sign-out moves the sign-out to now).
 */
function WebPunchButton({ signedInAt, signedOutAt, minimumMinutes }: { signedInAt: string | null; signedOutAt: string | null; minimumMinutes: number | null }) {
  const [pending, start] = useTransition();
  const signedIn = !!signedInAt;
  const signingOut = signedIn;
  return (
    <div className="mt-3 grid gap-1.5">
      <Button
        size="lg"
        className="w-full"
        variant={signingOut ? "outline" : "default"}
        disabled={pending}
        onClick={() => {
          if (signingOut && signedInAt) {
            const workedNow = Math.max(0, (Date.now() - Date.parse(signedInAt)) / 60_000);
            const message = minimumMinutes !== null && workedNow < minimumMinutes
              ? `You've worked ${hm(workedNow)} — signing out now marks a Short day. Sign out anyway?`
              : `Sign out now? Worked ${hm(workedNow)}`;
            if (!confirm(message)) return;
          }
          start(async () => {
            const r = await webPunchAction();
            if (r.ok) toast.success(signingOut ? "Signed out." : "Signed in.");
            else toast.error(r.error);
          });
        }}
      >
        {signingOut ? <LogOut className="size-4" /> : <LogIn className="size-4" />}
        {!signedIn ? "Sign in" : signedOutAt ? "Sign out again" : "Sign out"}
      </Button>
      {signedOutAt && <p className="text-center text-xs text-muted-foreground">Signed out at {time12(signedOutAt)} · signing out again moves it to now</p>}
    </div>
  );
}
