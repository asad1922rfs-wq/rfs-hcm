import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DAY_STATUSES, type DayStatus } from "@/core/attendance/day-status";
import { formatHoursMinutes } from "@/core/attendance/month-calendar";
import type { RegisterRow } from "@/server/services/attendance-edit";
import { to12h } from "@/lib/format";
import { AdjustDialog } from "./adjust-dialog";

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

/** Attendance rows with optional per-row editing. `mode` decides whether the first column is the employee or the date. */
export function RegisterTable({ rows, canEdit, mode }: { rows: RegisterRow[]; canEdit: boolean; mode: "daily" | "monthly" }) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{mode === "daily" ? "Employee" : "Date"}</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Check-in</TableHead>
            <TableHead>Check-out</TableHead>
            <TableHead className="hidden sm:table-cell">Worked</TableHead>
            <TableHead className="hidden md:table-cell">Late / early</TableHead>
            <TableHead className="hidden lg:table-cell">Machine punches</TableHead>
            {canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.employeeId}-${r.date}`} className={r.isOffDay && !r.status ? "text-muted-foreground" : undefined}>
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
                {r.adjustment && <Badge variant="outline" className="ml-1 text-[10px]" title={r.adjustment.reason}>Edited</Badge>}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{show(r.checkIn)}</TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">{show(r.checkOut)}</TableCell>
              <TableCell className="hidden sm:table-cell tabular-nums">{r.workedMinutes !== null ? formatHoursMinutes(r.workedMinutes) : "—"}</TableCell>
              <TableCell className="hidden md:table-cell text-xs">
                {r.status === "LATE" ? <span className="text-warning-foreground dark:text-warning">Late {r.lateMinutes}m</span> : null}
                {r.earlyLeaveMinutes > 0 && <span className="ml-1">Early {r.earlyLeaveMinutes}m</span>}
                {r.status !== "LATE" && !r.earlyLeaveMinutes && "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                {r.machinePunches.length ? r.machinePunches.map((p, i) => <span key={i} className="mr-1.5 whitespace-nowrap">{show(p)}</span>) : "—"}
              </TableCell>
              {canEdit && <TableCell className="text-right"><AdjustDialog row={r} /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

