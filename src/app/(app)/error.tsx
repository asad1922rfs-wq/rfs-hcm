"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// A page opened before a deployment calls server actions that no longer exist ("Failed to find Server Action").
// Reload once to pick up the new version instead of showing a dead page.
const RELOAD_KEY = "rfs-reloaded-after-update";
const isStaleDeployment = (e: Error) => /server action|deployment|ChunkLoadError|Loading chunk/i.test(`${e.name} ${e.message}`);

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleDeployment(error);

  useEffect(() => {
    if (!stale) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return;
      sessionStorage.setItem(RELOAD_KEY, "1");
    } catch {
      /* storage blocked: still reload once */
    }
    window.location.reload();
  }, [stale]);

  useEffect(() => {
    // A successful render after the reload clears the guard for the next update.
    const t = setTimeout(() => { try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ } }, 10_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto mt-24 grid max-w-md gap-4 text-center">
      <h1 className="text-xl font-semibold">{stale ? "The app was updated" : "Something went wrong"}</h1>
      <p className="text-sm text-muted-foreground">
        {stale
          ? "This page was opened before the latest update. Reload it and try again — nothing was saved."
          : "Please try again. If it keeps happening, reload the page."}
      </p>
      <div className="flex justify-center gap-2">
        <Button onClick={() => window.location.reload()}><RefreshCw className="size-4" /> Reload page</Button>
        {!stale && <Button variant="outline" onClick={reset}>Try again</Button>}
      </div>
    </div>
  );
}
