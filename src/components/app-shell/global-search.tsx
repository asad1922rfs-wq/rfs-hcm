"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Search, User } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { globalSearchAction, type SearchResult } from "@/app/(app)/search-action";
import type { NavSection } from "./nav";

/** Top-bar search (Ctrl+K / ⌘K): employees by name or ID, and pages from the viewer's navigation. */
export function GlobalSearch({ sections }: { sections: NavSection[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced employee search; stale responses are ignored.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setPeople([]);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(() => start(async () => {
      const r = await globalSearchAction(q);
      if (id === seq.current) setPeople(r);
    }), 200);
    return () => clearTimeout(t);
  }, [query]);

  const pages = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    const all = sections.flatMap((s) => s.items.filter((i) => !i.soon).map((i) => ({ kind: "page" as const, title: i.label, subtitle: s.title, href: i.href })));
    return q ? all.filter((p) => p.title.toLowerCase().includes(q) || p.subtitle.toLowerCase().includes(q)).slice(0, 6) : all.slice(0, 6);
  }, [query, sections]);

  const results = [...people, ...pages];
  const go = (r: SearchResult | undefined) => {
    if (!r) return;
    setOpen(false);
    setQuery("");
    router.push(r.href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground hover:bg-muted"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">Search employees, ID or pages…</span>
        <kbd className="hidden rounded border bg-background px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <DialogContent className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-xl" showCloseButton={false}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
              }}
              placeholder="Type a name, Employee ID, phone, or page…"
              className="h-12 flex-1 bg-transparent text-sm outline-none"
              aria-label="Search"
            />
            {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          <ul className="max-h-96 overflow-y-auto p-2" role="listbox">
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">{query.trim().length < 2 ? "Type at least 2 characters" : "No matches"}</li>
            )}
            {results.map((r, i) => (
              <li key={`${r.kind}-${r.href}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cn("flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm", i === active && "bg-accent text-accent-foreground")}
                >
                  {r.kind === "employee" ? <User className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.kind === "employee" ? r.subtitle : `Go to page · ${r.subtitle}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
