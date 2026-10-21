import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Upload } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth/session";
import { dailyRegister } from "@/server/services/attendance-edit";
import { listDepartments } from "@/server/services/organisation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/common";
import { NativeSelect } from "@/components/form";
import { addDaysIso } from "@/core/attendance/engine";
import { parseDateOnly, todayInPKT, toDateOnlyString } from "@/lib/dates";
import { RegisterTable } from "./register-table";

export const metadata = { title: "Attendance" };

function validDate(v: string | undefined, fallback: string): string {
  try {
    return v ? toDateOnlyString(parseDateOnly(v)) : fallback;
  } catch {
    return fallback;
  }
}

export default async function AttendanceRegisterPage({ searchParams }: { searchParams: Promise<{ date?: string; department?: string; q?: string }> }) {
  const actor = await requirePagePermission("attendance.read", "team");
  const sp = await searchParams;
  const today = toDateOnlyString(todayInPKT());
  const date = validDate(sp.date, today);
  const [{ rows, canEdit, trackedFrom, shifts }, departments] = await Promise.all([dailyRegister(actor, date, sp.department || undefined, sp.q), listDepartments()]);
  const qs = (d: string) => `/attendance?${new URLSearchParams({ date: d, ...(sp.department ? { department: sp.department } : {}), ...(sp.q ? { q: sp.q } : {}) })}`;
  const counts = rows.reduce<Record<string, number>>((m, r) => ((m[r.status ?? "NONE"] = (m[r.status ?? "NONE"] ?? 0) + 1), m), {});
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

  const summary = (
    <p className="mb-3 text-sm text-muted-foreground">
      <span className="font-medium text-foreground">{weekday}</span> · {rows.length} employees ·{" "}
      {["PRESENT", "LATE", "EARLY", "MISSING", "ABSENT"].filter((s) => counts[s]).map((s) => `${counts[s]} ${s.toLowerCase()}`).join(" · ") || "no attendance yet"}
    </p>
  );

  const filters = (
      <form className="flex flex-wrap items-center gap-2" role="search">
        <Button asChild variant="outline" size="icon" aria-label="Previous day"><Link href={qs(addDaysIso(date, -1))}><ChevronLeft /></Link></Button>
        <Input type="date" name="date" defaultValue={date} max={today} className="w-44" aria-label="Date" />
        {date < today && <Button asChild variant="outline" size="icon" aria-label="Next day"><Link href={qs(addDaysIso(date, 1))}><ChevronRight /></Link></Button>}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={sp.q} placeholder="Search name or ID" className="w-56 pl-9" aria-label="Search employee" />
        </div>
        <NativeSelect name="department" defaultValue={sp.department ?? ""} className="w-48" aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </NativeSelect>
        <Button type="submit" variant="secondary">Show</Button>
        {date !== today && <Button asChild variant="ghost"><Link href="/attendance">Today</Link></Button>}
      </form>
  );

  return (
    <>
      <PageHeader
        title="Attendance"
        description={canEdit ? "Daily register. Use Edit to correct a check-in or check-out." : "Daily register"}
        actions={can(actor, "attendance.manage", "all") && <Button asChild variant="outline"><Link href="/attendance/import"><Upload /> Import log</Link></Button>}
      />

      {rows.length === 0 ? (
        <>
          <div className="mb-4">{filters}</div>
          {summary}
          <EmptyState
            title={
              trackedFrom && date < trackedFrom
                ? `Attendance is tracked in this system from ${new Date(`${trackedFrom}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`
                : sp.q ? `No employee matches “${sp.q}”` : "No employees for this date"
            }
          />
        </>
      ) : (
        <RegisterTable rows={rows} canEdit={canEdit} shifts={shifts} mode="daily" toolbar={filters} summary={summary} today={today} />
      )}
    </>
  );
}
