"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the current server page periodically (while the tab is visible) so new punches show up, and at once
 * when the tab becomes visible again or the window gets focus: a laptop woken in the morning must not keep showing
 * yesterday's page (timers do not run while it sleeps).
 */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      last = Date.now();
      router.refresh();
    };
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, seconds * 1000);
    // Coming back to the tab: refresh unless that just happened (focus and visibilitychange often fire together).
    const onBack = () => {
      if (document.visibilityState === "visible" && Date.now() - last > 5_000) refresh();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [router, seconds]);
  return null;
}
