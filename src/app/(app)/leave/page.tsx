import Link from "next/link";
import { can, requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { allLeaveRequests, approvalQueue, currentYear, leaveBalances, listLeaveTypes, myLeaveRequests } from "@/server/services/leave";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CancelButton, DecideButtons, RequestLeaveDialog } from "./leave-client";

export const metadata = { title: "Leave" };

const STATUS: Record<string, string> = {
  PENDING: "bg-warning/20 text-warning-foreground dark:text-warning",
  APPROVED: "bg-success/15 text-success",
  REJECTED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
};
const Status = ({ s }: { s: string }) => <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS[s])}>{s.charAt(0) + s.slice(1).toLowerCase()}</span>;

type Row = Awaited<ReturnType<typeof myLeaveRequests>>[number];

function RequestsTable({ rows, showEmployee, actions }: { rows: Row[]; showEmployee?: boolean; actions?: (r: Row) => React.ReactNode }) {
  if (rows.length === 0) return <EmptyState title="Nothing here" />;
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            {showEmployee && <TableHead>Employee</TableHead>}
            <TableHead>Type</TableHead>
            <TableHead>Dates</TableHead>
            <TableHead className="text-right">Days</TableHead>
            <TableHead className="hidden md:table-cell">Reason</TableHead>
            <TableHead>Status</TableHead>
            {actions && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="align-top">
              {showEmployee && (
                <TableCell>
                  <Link href={`/employees/${r.employee.id}`} className="font-medium hover:underline">{r.employee.fullName}</Link>
                  <span className="block text-xs text-muted-foreground">{r.employee.employeeCode}{r.employee.department ? ` · ${r.employee.department.name}` : ""}</span>
                </TableCell>
              )}
              <TableCell>{r.leaveType.name}{!r.leaveType.isPaid && <span className="block text-xs text-muted-foreground">unpaid</span>}</TableCell>
              <TableCell className="whitespace-nowrap">{formatDate(r.startDate)}{r.endDate.getTime() !== r.startDate.getTime() && <> – {formatDate(r.endDate)}</>}</TableCell>
              <TableCell className="text-right tabular-nums">{r.days}</TableCell>
              <TableCell className="hidden max-w-xs md:table-cell">
                <span className="line-clamp-2 text-sm">{r.reason}</span>
                {r.decisionNote && <span className="block text-xs text-muted-foreground">Note: {r.decisionNote}</span>}
              </TableCell>
              <TableCell><Status s={r.status} /></TableCell>
              {actions && <TableCell className="text-right">{actions(r)}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default async function LeavePage({ searchParams }: { searchParams: Promise<{ view?: string; status?: string; month?: string }> }) {
  const actor = await requirePagePermission("leave.read", "self");
  const sp = await searchParams;
  const year = currentYear();
  const canApprove = can(actor, "leave.approve", "team");
  const isHr = can(actor, "leave.approve", "all");
  const canSeeAll = can(actor, "leave.read", "team");
  const view = sp.view === "approvals" && canApprove ? "approvals" : sp.view === "all" && canSeeAll ? "all" : "mine";

  const [types, balances, mine, queue] = await Promise.all([
    listLeaveTypes(),
    actor.employeeId ? leaveBalances(actor.employeeId, year) : Promise.resolve([]),
    actor.employeeId ? myLeaveRequests(actor.employeeId) : Promise.resolve([]),
    approvalQueue(actor),
  ]);
  const status = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(sp.status ?? "") ? (sp.status as "PENDING") : undefined;
  const all = view === "all" ? await allLeaveRequests(actor, { status, month: sp.month }) : [];
  const employees = isHr
    ? (await db.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, employeeCode: true } })).map((e) => ({ id: e.id, label: `${e.fullName} (${e.employeeCode})` }))
    : undefined;
  // HR's "Record leave" list is for any employee, so it only marks permanent-only types; the server checks the chosen employee.
  const hrTypeOptions = types.map((t) => ({ id: t.id, label: t.name, isPaid: t.isPaid, remaining: null, permanentOnly: t.permanentOnly, ineligibleReason: null }));
  const typeOptions = types.map((t) => {
    const b = balances.find((x) => x.leaveTypeId === t.id);
    return { id: t.id, label: t.name, isPaid: t.isPaid, remaining: b?.remaining ?? null, permanentOnly: t.permanentOnly, ineligibleReason: b && !b.eligible ? b.ineligibleReason : null };
  });

  const tab = (v: string, label: string, count?: number) => (
    <Link
      href={`/leave?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={cn("-mb-px rounded-t-md border border-b-0 px-4 py-2 text-xs font-semibold uppercase tracking-wide", view === v ? "border-border bg-card text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {label}{count ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{count}</span> : null}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Leave"
        description={`Calendar year ${year}. Leave counts working days only; approved leave shows in attendance and unpaid leave is deducted in payroll.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {employees && <RequestLeaveDialog types={hrTypeOptions} employees={employees} trigger="Record leave" />}
            {actor.employeeId && can(actor, "leave.request", "self") && <RequestLeaveDialog types={typeOptions} trigger="Request leave" />}
          </div>
        }
      />
      <nav className="mb-5 flex gap-1 border-b">
        {tab("mine", "My leave")}
        {canApprove && tab("approvals", "Approvals", queue.length)}
        {canSeeAll && tab("all", isHr ? "All requests" : "Team requests")}
      </nav>

      {view === "mine" && (
        <div className="grid gap-6">
          {balances.length > 0 ? (
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {balances.map((b) => (
                <Card key={b.leaveTypeId} className="gap-1 py-4">
                  <CardHeader className="px-4"><CardTitle className="text-sm">{b.name}{!b.isPaid && <span className="ml-1 font-normal text-muted-foreground">(unpaid)</span>}</CardTitle></CardHeader>
                  <CardContent className="px-4">
                    {b.eligible ? (
                      <>
                        <p className="text-2xl font-semibold tabular-nums">{b.remaining ?? "—"}<span className="text-sm font-normal text-muted-foreground">{b.entitlement !== null ? ` / ${b.entitlement} left` : " no limit"}</span></p>
                        <p className="text-xs text-muted-foreground">{b.used} used{b.pending ? ` · ${b.pending} pending` : ""}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-base font-medium text-muted-foreground">{b.ineligibleReason}</p>
                        <p className="text-xs text-muted-foreground">Available after confirmation as a permanent employee.</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              ))}
            </section>
          ) : (
            <EmptyState title="No leave types yet" description={can(actor, "settings.organisation", "all") ? "Add leave types (Annual, Sick, Casual, Unpaid…) with their yearly days under Administration → Leave types." : "HR has not set up leave types yet."} />
          )}
          <div>
            <h2 className="mb-3 text-lg font-semibold">My requests</h2>
            <RequestsTable rows={mine} actions={(r) => (r.status === "PENDING" ? <CancelButton id={r.id} /> : null)} />
          </div>
        </div>
      )}

      {view === "approvals" && (
        <RequestsTable rows={queue} showEmployee actions={(r) => <DecideButtons id={r.id} name={r.employee.fullName} />} />
      )}

      {view === "all" && (
        <>
          <form className="mb-3 flex flex-wrap gap-2">
            <input type="hidden" name="view" value="all" />
            <select name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border bg-transparent px-3 text-sm" aria-label="Status">
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <input type="month" name="month" defaultValue={sp.month} className="h-9 rounded-md border bg-transparent px-3 text-sm" aria-label="Month" />
            <button type="submit" className="h-9 rounded-md bg-secondary px-4 text-sm font-medium">Filter</button>
          </form>
          <RequestsTable rows={all} showEmployee actions={isHr ? (r) => (r.status === "APPROVED" || r.status === "PENDING" ? <CancelButton id={r.id} /> : null) : undefined} />
        </>
      )}
    </>
  );
}
