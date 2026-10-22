"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, FolderOpen, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type RequestRow = { label: string; count: number | null; href?: string };

/** "My requests" / "My approvals". A null count means the request type opens in a later phase. */
export function RequestsCard({ requests, approvals, showApprovals, newRequestHref }: { requests: RequestRow[]; approvals: RequestRow[]; showApprovals: boolean; newRequestHref?: string }) {
  const [tab, setTab] = useState<"requests" | "approvals">("requests");
  const rows = tab === "requests" ? requests : approvals;
  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b" role="tablist">
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")} icon={<FolderOpen className="size-4" />}>My requests</TabButton>
        {showApprovals && (
          <TabButton active={tab === "approvals"} onClick={() => setTab("approvals")} icon={<Eye className="size-4" />}>My approvals</TabButton>
        )}
      </div>
      <div className="flex justify-between px-4 py-2 text-xs font-semibold text-primary">
        <span>Type</span>
        <span>{tab === "requests" ? "Value" : "Pending"}</span>
      </div>
      <ul className="max-h-64 flex-1 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
            {r.href ? (
              <Link href={r.href} className="hover:text-primary hover:underline">{r.label}</Link>
            ) : (
              <span className={cn(r.count === null && "text-muted-foreground")}>{r.label}</span>
            )}
            {r.count === null ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">Soon</span>
            ) : (
              <span className="min-w-8 rounded bg-primary/10 px-2 py-0.5 text-center text-xs font-medium tabular-nums text-primary">{r.count}</span>
            )}
          </li>
        ))}
      </ul>
      {tab === "requests" && newRequestHref && (
        <div className="border-t px-4 py-2.5 text-right">
          <Link href={newRequestHref} className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><Plus className="size-3.5" /> Attendance request</Link>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 px-3 py-3 text-xs font-semibold uppercase tracking-wide",
        active ? "bg-muted text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
