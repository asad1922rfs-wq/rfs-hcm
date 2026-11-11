"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** No mouse, keyboard or touch for this long = nobody is looking: stop the timed refresh (saves hosting traffic). */
const IDLE_AFTER_MS = 15 * 60_000;

/**
 * Re-fetches the current server page periodically (while the tab is visible and someone is using it) so new punches
 * show up, and at once when the tab becomes visible again, the window gets focus, or the user comes back after being
 * idle: a laptop woken in the morning must not keep showing yesterday's page (timers do not run while it sleeps).
 */
export function AutoRefresh({ seconds = 300 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    let lastActivity = Date.now();
    const refresh = () => {
      last = Date.now();
      router.refresh();
    };
    const idle = () => Date.now() - lastActivity > IDLE_AFTER_MS;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !idle()) refresh();
    }, seconds * 1000);
    // Coming back to the tab: refresh unless that just happened (focus and visibilitychange often fire together).
    const onBack = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5_000) refresh();
    };
    // Activity after an idle spell: the page may be stale, so refresh once straight away.
    const onActivity = () => {
      const wasIdle = idle();
      lastActivity = Date.now();
      if (wasIdle) onBack();
    };
    const activity = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"] as const;
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    for (const e of activity) window.addEventListener(e, onActivity, { passive: true });
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
      for (const e of activity) window.removeEventListener(e, onActivity);
    };
  }, [router, seconds]);
  return null;
}
