import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireActor } from "@/server/auth/session";
import { attendanceApprovalQueue, myAttendanceRequests, openRequestMonths, waiverAllowance } from "@/server/services/attendance-requests";
import { localTime } from "@/server/services/attendance-edit";
import { db } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { formatHoursMinutes } from "@/core/attendance/month-calendar";
import { MONTHLY_WAIVER_LIMIT } from "@/core/attendance/waiver";
import { formatDate, to12h } from "@/lib/format";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";
import { attendanceStartOf } from "@/server/json-fields";
import { cn } from "@/lib/utils";
import { CancelWaiverButton, DecideWaiverButtons, RequestWaiverDialog } from "./requests-client";

export const metadata = { title: "Attendance requests" };

const STATUS: Record<string, string> = {
  PENDING: "bg-warning/20 text-warning-foreground dark:text-warning",
  APPROVED: "bg-success/15 text-success",
  REJECTED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};
const Status = ({ s }: { s: string }) => <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[s])}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>;
const clock = (d: Date | null, date: string) => {
  const t = localTime(d, date);
  return t ? `${to12h(t.time)}${t.nextDay ? " (+1)" : ""}` : "—";
};

export default async function AttendanceRequestsPage({ searchParams }: { searchParams: Promise<{ view?: string; new?: string }> }) {
  const actor = await requireActor();
  const canRequest = !!actor.employeeId && can(actor, "attendance.request", "self");
  const canApprove = can(actor, "attendance.approve", "team");
  if (!canRequest && !canApprove) redirect("/forbidden");
  const sp = await searchParams;
  const view = (sp.view === "approvals" && canApprove) || !canRequest ? "approvals" : "mine";

  const today = toDateOnlyString(todayInPKT());
  const [mine, queue, months, employee, company] = await Promise.all([
    canRequest ? myAttendanceRequests(actor.employeeId!) : Promise.resolve([]),
    attendanceApprovalQueue(actor),
    canRequest ? openRequestMonths() : Promise.resolve([]),
    canRequest ? db.employee.findUnique({ where: { id: actor.employeeId! }, select: { joiningDate: true } }) : Promise.resolve(null),
    db.company.findFirst({ select: { attendanceStartDate: true } }),
  ]);
  const left = canRequest ? await waiverAllowance(actor.employeeId!, months) : {};
  const earliest = [months.length ? `${months[months.length - 1]}-01` : today, attendanceStartOf(company), employee ? toDateOnlyString(employee.joiningDate) : null]
    .filter((d): d is string => !!d).sort().at(-1)!;
  const thisMonthLeft = left[today.slice(0, 7)];

  const tab = (v: string, label: string, count?: number) => (
    <Link
      href={`/attendance/requests?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={cn("-mb-px rounded-t-md border border-b-0 px-4 py-2 text-xs font-semibold uppercase tracking-wide", view === v ? "border-border bg-card text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {label}{count ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{count}</span> : null}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Attendance requests"
        description={`Up to ${MONTHLY_WAIVER_LIMIT} requests per month. Full-hours requests need the full shift worked; forgot to punch, prior permission and half day need only approval. Approved days have no deduction.`}
        actions={canRequest ? <RequestWaiverDialog left={left} min={earliest} max={today} defaultOpen={sp.new === "1"} /> : undefined}
      />
      <nav className="mb-5 flex gap-1 border-b">
        {canRequest && tab("mine", "My requests")}
        {canApprove && tab("approvals", "Approvals", queue.length)}
      </nav>

      {view === "mine" && (
        <>
          {thisMonthLeft !== undefined && (
            <p className="mb-3 text-sm text-muted-foreground"><span className="font-medium text-foreground">{thisMonthLeft} of {MONTHLY_WAIVER_LIMIT}</span> left this month</p>
          )}
          {mine.length === 0 ? (
            <EmptyState title="No attendance requests yet" />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="hidden md:table-cell">Hours</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mine.map((r) => (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="whitespace-nowrap">{formatDate(r.workDate)}</TableCell>
                      <TableCell className="max-w-sm">
                        <span className="text-sm">{r.reasonText}</span>
                        {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                        {r.decisionNote && <span className="block text-xs text-muted-foreground">Reviewer: {r.decisionNote}</span>}
                      </TableCell>
                      <TableCell className="hidden tabular-nums md:table-cell">
                        {r.workedMinutes !== null && r.requiredMinutes !== null ? `${formatHoursMinutes(r.workedMinutes)} of ${formatHoursMinutes(r.requiredMinutes)}` : "—"}
                      </TableCell>
                      <TableCell><Status s={r.status} /></TableCell>
                      <TableCell className="text-right">{r.status === "PENDING" ? <CancelWaiverButton id={r.id} /> : null}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {view === "approvals" && (
        queue.length === 0 ? (
          <EmptyState title="Nothing waiting" description="Pending attendance requests from your team show here." />
        ) : (
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Check-in / out</TableHead>
                  <TableHead>Worked</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {queue.map((r) => {
                  const date = toDateOnlyString(r.workDate);
                  return (
                    <TableRow key={r.id} className="align-top">
                      <TableCell>
                        <Link href={`/employees/${r.employee.id}`} className="font-medium hover:underline">{r.employee.fullName}</Link>
                        <span className="block text-xs text-muted-foreground">{r.employee.employeeCode}{r.employee.department ? ` · ${r.employee.department.name}` : ""}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Link href={`/attendance?date=${date}`} className="hover:underline">{formatDate(r.workDate)}</Link>
                        {r.day && <span className="block text-xs text-muted-foreground">{r.day.status.charAt(0) + r.day.status.slice(1).toLowerCase()}{r.day.lateMinutes ? ` · ${r.day.lateMinutes} min late` : ""}</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{r.day ? `${clock(r.day.firstIn, date)} – ${clock(r.day.lastOut, date)}` : "No attendance"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <span className={cn(r.blockedReason && "text-destructive")}>
                          {r.day?.workedMinutes != null ? formatHoursMinutes(r.day.workedMinutes) : "—"} of {formatHoursMinutes(r.requiredMinutes)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden max-w-xs md:table-cell">
                        <span className="text-sm">{r.reasonText}</span>
                        {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                        {r.blockedReason && <span className="block text-xs text-destructive">{r.blockedReason}</span>}
                      </TableCell>
                      <TableCell className="text-right"><DecideWaiverButtons id={r.id} name={r.employee.fullName} blockedReason={r.blockedReason} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )
      )}
    </>
  );
}
