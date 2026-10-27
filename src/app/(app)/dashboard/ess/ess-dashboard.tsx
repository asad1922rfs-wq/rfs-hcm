import Link from "next/link";
import { CalendarCheck2, CalendarDays, Cake, HandCoins, Info, ListChecks, ReceiptText, TriangleAlert } from "lucide-react";
import type { getEssDashboard } from "@/server/services/ess-dashboard";
import type { WorkClock } from "@/server/services/work-clock";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common";
import { formatDateTime, formatPKR } from "@/lib/format";
import { formatHoursMinutes } from "@/core/attendance/month-calendar";
import { initials } from "@/lib/utils";
import { AttendanceFlagChart, AttendanceLegend, type ChartDay } from "./attendance-chart";
import { DashboardFilters } from "./filters";
import { RequestsCard } from "./requests-card";
import { WorkClockPanel } from "./work-clock";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";

type Data = Awaited<ReturnType<typeof getEssDashboard>> & { workClock?: WorkClock | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function CardTitleBar({ icon: Icon, title, action }: { icon: React.ComponentType<{ className?: string }>; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
        <Icon className="size-4" /> {title}
      </h2>
      {action}
    </div>
  );
}

function TableHead({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex justify-between px-4 py-2 text-xs font-semibold text-primary">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

export function EssDashboard({ data, canImport, showApprovals, canRequestAttendance }: { data: Data; canImport: boolean; showApprovals: boolean; canRequestAttendance: boolean }) {
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const periodLabels = {
    current: `${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`,
    previous: `${MONTHS[prev.getUTCMonth()]} ${prev.getUTCFullYear()}`,
  };

  if (!data.subject) {
    return (
      <EmptyState
        title="No employee to show"
        description="Your account is not linked to an employee record. Add employees, then pick one here to see their dashboard."
      />
    );
  }
  const s = data.subject;
  const monthName = `${FULL_MONTHS[data.month - 1]} ${data.year}`;
  const chartDays: ChartDay[] = s.calendar.map((d) => ({
    date: d.date,
    label: `${String(d.day).padStart(2, "0")}-${MONTHS[data.month - 1]}`,
    status: d.status,
    workedMinutes: d.workedMinutes,
    signIn: d.signIn,
    signOut: d.signOut,
    holiday: d.holiday,
  }));

  return (
    <div className="grid gap-4">
      {!data.sync.lastPunchAt ? (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            No biometric attendance has been received yet, so working days show as <strong>Not synced</strong>.{" "}
            {canImport ? (
              <Link href="/attendance/import" className="font-medium text-primary hover:underline">Import the ZKTeco attendance log</Link>
            ) : (
              "HR will connect the attendance machine."
            )}
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Attendance synced up to {formatDateTime(data.sync.lastPunchAt)} (PKT)</p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(260px,1fr)_3fr]">
        {/* Profile */}
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-1 flex-col items-center px-4 py-6 text-center">
            <Avatar className="size-24">
              <AvatarFallback className="bg-primary text-2xl text-primary-foreground">{initials(s.fullName)}</AvatarFallback>
            </Avatar>
            <p className="mt-4 font-semibold">
              {s.fullName} <span className="text-muted-foreground">({s.deviceUserId ?? s.employeeCode})</span>
            </p>
            <p className="text-sm text-primary">{s.designation?.title ?? s.department?.name ?? "—"}</p>
            <Link href={s.isSelf ? "/me" : `/employees/${s.id}`} className="mt-1 flex items-center gap-1 text-sm text-primary hover:underline">
              <Info className="size-3.5" /> {s.isSelf ? "My info" : "Employee info"}
            </Link>
            {data.workClock && <WorkClockPanel clock={data.workClock} canPunch={s.isSelf && data.workClock.remote} />}
          </div>
          <div className="grid grid-cols-2 border-t text-center text-xs text-muted-foreground">
            <div className="flex flex-col items-center gap-2 border-r px-2 py-4">
              <Cake className="size-5 text-primary" />
              {s.birthdayToday ? <span className="font-medium text-foreground">Happy birthday! 🎉</span> : "No birthday today"}
            </div>
            <div className="flex flex-col items-center gap-2 px-2 py-4">
              <CalendarCheck2 className="size-5 text-success" />
              {s.anniversaryYears > 0 ? (
                <span className="font-medium text-foreground">{s.anniversaryYears} year work anniversary</span>
              ) : (
                "No work anniversary today"
              )}
            </div>
          </div>
        </Card>

        {/* Attendance flag summary */}
        <Card className="gap-0 py-0">
          <CardTitleBar
            icon={CalendarDays}
            title="Attendance flag summary"
            action={
              <DashboardFilters
                employees={data.employeeOptions}
                selectedEmployeeId={s.id}
                period={data.period}
                periodLabels={periodLabels}
              />
            }
          />
          <div className="grid gap-3 px-4 py-4">
            <AttendanceLegend />
            <AttendanceFlagChart days={chartDays} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-0 overflow-hidden py-0">
          <RequestsCard
            showApprovals={showApprovals}
            newRequestHref={s.isSelf && canRequestAttendance ? "/attendance/requests?new=1" : undefined}
            requests={[
              { label: "Attendance requests (pending)", count: data.attendanceRequests?.pending ?? 0, href: s.isSelf ? "/attendance/requests" : undefined },
              { label: `Leave requests (pending)`, count: data.leaveRequests?.pending ?? 0 },
              { label: `Leave approved this year`, count: data.leaveRequests?.approved ?? 0 },
              { label: "Loan requests (pending)", count: s.loans?.pendingRequests ?? 0 },
              { label: "Employee info requests", count: null },
            ]}
            approvals={[
              { label: "Attendance corrections", count: data.pendingAttendanceApprovals ?? 0, href: "/attendance/requests?view=approvals" },
              { label: "Leave requests", count: data.pendingApprovals ?? 0 },
              ...(data.canManageLoans ? [{ label: "Loan requests", count: data.pendingLoanApprovals ?? 0 }] : []),
            ]}
          />
        </Card>

        <Card className="gap-0 py-0">
          <CardTitleBar icon={ListChecks} title="Leave summary" />
          <TableHead left="Title" right="Balance" />
          {data.leave && data.leave.length > 0 ? (
            <dl className="max-h-72 overflow-y-auto">
              {data.leave.map((b) => (
                <div key={b.leaveTypeId} className="flex items-center justify-between border-t px-4 py-2.5 text-sm">
                  <dt>{b.name}{!b.isPaid && <span className="text-xs text-muted-foreground"> (unpaid)</span>}</dt>
                  {b.eligible ? (
                    <dd className="min-w-12 rounded bg-muted px-2 py-0.5 text-right tabular-nums" title={`${b.used} used${b.pending ? `, ${b.pending} pending` : ""}`}>
                      {b.remaining !== null ? b.remaining.toFixed(2) : `${b.used} used`}
                    </dd>
                  ) : (
                    <dd className="text-xs text-muted-foreground" title="Available after confirmation as a permanent employee">{b.ineligibleReason}</dd>
                  )}
                </div>
              ))}
              <div className="border-t px-4 py-2.5 text-right"><Link href="/leave" className="text-sm text-primary hover:underline">Request leave</Link></div>
            </dl>
          ) : (
            <div className="flex flex-1 items-center justify-center px-4 py-10 text-center text-sm text-muted-foreground">
              No leave types configured yet.
            </div>
          )}
        </Card>

        <Card className="gap-0 py-0">
          <CardTitleBar icon={CalendarCheck2} title="Attendance summary" />
          <TableHead left={`${monthName} · to ${s.summaryUntil.slice(8)}th`} right="Days" />
          <dl className="max-h-72 overflow-y-auto">
            {[
              ["Present", s.summary.present],
              ["Absent", s.summary.absent],
              ["Leave", s.summary.leave],
              ["Half day", s.summary.halfDay],
              ["Late", s.summary.late],
              ["Early leave", s.summary.early],
              ["Missing punch", s.summary.missing],
              ["Off days", s.summary.offDays],
              ["Not synced", s.summary.notSynced],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-t px-4 py-2.5 text-sm">
                <dt>{label}</dt>
                <dd className="min-w-12 rounded bg-muted px-2 py-0.5 text-right tabular-nums">{Number(value).toFixed(2)}</dd>
              </div>
            ))}
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm font-medium">
              <dt>Worked hours</dt>
              <dd className="tabular-nums">{formatHoursMinutes(s.summary.workedMinutes)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="gap-0 py-0">
          <PrivacyGroup>
          <CardTitleBar icon={ReceiptText} title="Employee payslip" action={<PrivacyToggle />} />
          <TableHead left="Payslip period" right="" />
          <ul>
            <li className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
              <span>{monthName}</span>
              {s.payslip ? (
                <Dialog>
                  <DialogTrigger className="text-primary hover:underline">{s.payslip.status === "ESTIMATE" ? "Expected payslip" : "View payslip"}</DialogTrigger>
                  <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>{s.payslip.status === "ESTIMATE" ? "Estimated salary" : "Salary"} · {monthName}</DialogTitle>
                      <DialogDescription>
                        {s.payslip.status === "ESTIMATE"
                          ? "Estimate only — it updates as attendance is processed and becomes final when payroll is approved."
                          : s.payslip.status === "PAID" ? "Approved and paid." : "Approved by Finance."}
                      </DialogDescription>
                    </DialogHeader>
                    <dl className="grid gap-2 text-sm">
                      <Row label={`Per-day rate (monthly salary ÷ ${s.payslip.daysInMonth} days)`} value={<PrivateAmount value={formatPKR(s.payslip.perDayRate, true)} />} muted />
                      {s.payslip.lines.map((l, i) => (
                        <Row key={i} label={l.label} value={<PrivateAmount value={`${l.kind === "DEDUCTION" ? "− " : ""}${formatPKR(l.amount)}`} />} />
                      ))}
                      <div className="flex justify-between border-t pt-2 font-semibold">
                        <dt>{s.payslip.status === "ESTIMATE" ? "Estimated net salary" : "Net salary"}</dt>
                        <dd className="tabular-nums"><PrivateAmount value={formatPKR(s.payslip.netPay)} /></dd>
                      </div>
                      {s.payslip.status === "ESTIMATE" && s.payslip.earnedToDate && s.payslip.earnedToDate.days > 0 && (
                        <div className="flex justify-between gap-4 rounded-md bg-primary/10 px-3 py-2 font-medium text-primary">
                          <dt>Earned till today ({earnedRange(s.payslip.earnedToDate)})</dt>
                          <dd className="shrink-0 tabular-nums"><PrivateAmount value={formatPKR(s.payslip.earnedToDate.amount)} /></dd>
                        </div>
                      )}
                    </dl>
                    {s.payslip.itemId ? (
                      <a href={`/api/v1/payslips/${s.payslip.itemId}`} target="_blank" rel="noopener" className="text-sm font-medium text-primary hover:underline">Download payslip (PDF)</a>
                    ) : (
                      <a href={`/api/v1/payslips/expected?employee=${encodeURIComponent(s.id)}&period=${data.period}`} target="_blank" rel="noopener" className="text-sm font-medium text-primary hover:underline">View expected payslip (PDF)</a>
                    )}
                    {s.payslip.warnings.length > 0 && (
                      <ul className="grid gap-1 text-xs text-muted-foreground">{s.payslip.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>
                    )}
                  </DialogContent>
                </Dialog>
              ) : (
                <span className="text-xs text-muted-foreground">No salary set</span>
              )}
            </li>
            {s.payHistory.filter((h) => h.label !== monthName).map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-sm">
                <span>{h.label}</span>
                <a href={`/api/v1/payslips/${h.id}`} target="_blank" rel="noopener" className="tabular-nums text-primary hover:underline"><PrivateAmount value={formatPKR(h.netPay)} /> · PDF</a>
              </li>
            ))}
          </ul>
          {s.payHistory.length === 0 && <p className="border-t px-4 py-6 text-center text-sm text-muted-foreground">No finalised payslips yet.</p>}
          {s.loans && s.loans.count > 0 && (
            <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-4 py-2.5 text-sm">
              <span className="flex items-center gap-2"><HandCoins className="size-4 text-primary" /> Loan balance{s.loans.count > 1 ? ` (${s.loans.count} loans)` : ""}</span>
              <Link href="/loans" className="text-primary hover:underline"><PrivateAmount value={formatPKR(s.loans.outstanding)} /></Link>
            </div>
          )}
          </PrivacyGroup>
        </Card>
      </div>
    </div>
  );
}

/** "1–19 Oct" */
function earnedRange(e: { from: string; to: string }) {
  const month = MONTHS[Number(e.to.slice(5, 7)) - 1];
  const from = Number(e.from.slice(8, 10));
  const to = Number(e.to.slice(8, 10));
  return from === to ? `${to} ${month}` : `${from}–${to} ${month}`;
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className={muted ? "flex justify-between gap-4 text-muted-foreground" : "flex justify-between gap-4"}>
      <dt>{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}
