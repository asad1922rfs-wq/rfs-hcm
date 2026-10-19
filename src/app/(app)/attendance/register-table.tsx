"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DAY_STATUSES, type DayStatus } from "@/core/attendance/day-status";
import { formatHoursMinutes } from "@/core/attendance/month-calendar";
import type { RegisterRow } from "@/server/services/attendance-edit";
import { to12h } from "@/lib/format";
import { AdjustDialog } from "./adjust-dialog";
import { BulkAdjustButton } from "./bulk-adjust";

const show = (t: { time: string; nextDay: boolean } | null) => (t ? <>{to12h(t.time)}{t.nextDay && <sup className="ml-0.5 text-[10px] text-muted-foreground">+1</sup>}</> : "—");

function StatusPill({ row }: { row: RegisterRow }) {
  const status: DayStatus | null = row.status ? (row.status as DayStatus) : row.isOffDay ? "OFF" : null;
  if (!status) return <span className="text-xs text-muted-foreground">No record</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="size-2.5 rounded-sm" style={{ background: DAY_STATUSES[status].color }} />
      {DAY_STATUSES[status].label}
      {row.status && row.isOffDay && <span className="text-muted-foreground">(off day)</span>}
    </span>
  );
}

/**
 * Attendance rows with optional editing. `mode` decides whether the first column is the employee (daily register,
 * with multi-select for bulk edits) or the date (one employee's month).
 */
export function RegisterTable({
  rows, canEdit, mode, toolbar, summary, today,
}: {
  rows: RegisterRow[];
  canEdit: boolean;
  mode: "daily" | "monthly";
  /** Filters shown on the left of the top bar (daily register); the Bulk edit button sits on the right. */
  toolbar?: ReactNode;
  /** Shown between the top bar and the table. */
  summary?: ReactNode;
  today?: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectable = canEdit && mode === "daily";
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.employeeId));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const date = rows[0]?.date;

  return (
    <>
      {(toolbar || (selectable && date)) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {toolbar}
          {selectable && date && (
            <div className="ml-auto flex items-center gap-2">
              {selected.size > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>}
              <BulkAdjustButton
                date={date}
                today={today ?? date}
                employees={rows.filter((r) => selected.size === 0 || selected.has(r.employeeId)).map((r) => ({ id: r.employeeId, name: r.fullName }))}
                selectedCount={selected.size}
                onDone={() => setSelected(new Set())}
              />
            </div>
          )}
        </div>
      )}
      {summary}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.employeeId)))}
                  />
                </TableHead>
              )}
              <TableHead>{mode === "daily" ? "Employee" : "Date"}</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead className="hidden sm:table-cell">Worked</TableHead>
              <TableHead className="hidden md:table-cell">Late / early</TableHead>
              {canEdit && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={`${r.employeeId}-${r.date}`}
                data-state={selected.has(r.employeeId) ? "selected" : undefined}
                className={r.isOffDay && !r.status ? "text-muted-foreground" : undefined}
              >
                {selectable && (
                  <TableCell>
                    <input type="checkbox" aria-label={`Select ${r.fullName}`} checked={selected.has(r.employeeId)} onChange={() => toggle(r.employeeId)} />
                  </TableCell>
                )}
                <TableCell>
                  {mode === "daily" ? (
                    <Link href={`/employees/${r.employeeId}?tab=attendance`} className="hover:underline">
                      <span className="block font-medium">{r.fullName}</span>
                      <span className="block text-xs text-muted-foreground">{r.employeeCode}{r.department ? ` · ${r.department}` : ""}</span>
                    </Link>
                  ) : (
                    <span className="whitespace-nowrap">
                      {new Date(`${r.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" })}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusPill row={r} />
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{show(r.checkIn)}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{show(r.checkOut)}</TableCell>
                <TableCell className="hidden sm:table-cell tabular-nums">{r.workedMinutes !== null ? formatHoursMinutes(r.workedMinutes) : "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-xs">
                  {r.status === "LATE" ? <span className="text-warning-foreground dark:text-warning">Late {r.lateMinutes}m</span> : null}
                  {r.earlyLeaveMinutes > 0 && <span className="ml-1">Early {r.earlyLeaveMinutes}m</span>}
                  {r.status !== "LATE" && !r.earlyLeaveMinutes && "—"}
                </TableCell>
                {canEdit && <TableCell className="text-right"><AdjustDialog row={r} /></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
