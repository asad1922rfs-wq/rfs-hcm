import Link from "next/link";
import {
  Briefcase, Cake, CalendarX, Clock, FileClock, Fingerprint, PartyPopper, UserCheck, UserMinus, UserPlus, Users, Wallet,
} from "lucide-react";
import { can, requireActor, type Actor } from "@/server/auth/session";
import { getDashboardData } from "@/server/services/dashboard";
import { getEssDashboard } from "@/server/services/ess-dashboard";
import { pendingLeaveCount } from "@/server/services/leave";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState, StatCard } from "@/components/common";
import { formatDate, formatDateTime, formatMinuteOfDay, formatPKR } from "@/lib/format";
import { cn, initials } from "@/lib/utils";
import { HeadcountChart } from "./headcount-chart";
import { EssDashboard } from "./ess/ess-dashboard";
import { AutoRefresh } from "@/components/auto-refresh";
import { PrivateAmount } from "@/components/private-amount";

export const metadata = { title: "Dashboard" };

type Search = { view?: string; employee?: string; period?: string };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const canSeeHr = can(actor, "employee.read", "team");
  // Admin accounts without an employee record land on the HR overview; everyone else on their ESS dashboard.
  const view = canSeeHr && (sp.view === "hr" || (!sp.view && !actor.employeeId)) ? "hr" : "ess";

  return (
    <>
      <AutoRefresh seconds={60} />
      <nav className="mb-5 flex gap-1 border-b" aria-label="Dashboard views">
        <TabLink href="/dashboard?view=ess" active={view === "ess"}>ESS dashboard</TabLink>
        {canSeeHr && <TabLink href="/dashboard?view=hr" active={view === "hr"}>HR overview</TabLink>}
      </nav>
      {view === "hr" ? (
        <HrOverview actor={actor} />
      ) : (
        <EssDashboard
          data={await getEssDashboard(actor, { employeeId: sp.employee, period: sp.period === "previous" ? "previous" : "current" })}
          canImport={can(actor, "attendance.manage", "all")}
          showApprovals={can(actor, "leave.approve", "team") || can(actor, "attendance.approve", "team")}
        />
      )}
    </>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "-mb-px rounded-t-md border border-b-0 px-4 py-2 text-xs font-semibold uppercase tracking-wide",
        active ? "border-border bg-card text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

async function HrOverview({ actor }: { actor: Actor }) {
  const data = await getDashboardData(actor);
  const at = data.attendanceToday;
  const pendingLeave = await pendingLeaveCount(actor);
  const pending = "Import or sync attendance to see this";

  return (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        {formatDate(data.today)} · Pakistan Standard Time
        {at && ` · attendance synced up to ${formatDateTime(at.lastPunchAt)}`}
      </p>

      <section aria-label="Workforce" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total employees" value={data.totalActive} hint="Active employees" icon={Users} />
        <StatCard label="New this month" value={data.newThisMonth} hint="Joined since the 1st" icon={UserPlus} tone="info" />
        <StatCard label="Inactive / exited" value={data.inactive} icon={UserMinus} tone="warning" />
        {data.estimatedPayroll !== null ? (
          <StatCard label="Estimated monthly payroll" value={<PrivateAmount value={formatPKR(data.estimatedPayroll)} />} hint="Basic + fixed allowances, before attendance" icon={Wallet} tone="success" />
        ) : (
          <StatCard label="Employment types" value={data.byEmploymentType.length} hint="Distinct types in use" icon={Briefcase} />
        )}
      </section>

      <section aria-label="Today's attendance" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Present today" value={at ? at.present : "—"} hint={at ? undefined : pending} icon={UserCheck} tone="success" />
        <StatCard label="Late today" value={at ? at.late : "—"} hint={at ? undefined : pending} icon={Clock} tone="warning" />
        <StatCard label="Not checked in" value={at ? at.notCheckedIn : "—"} hint={at ? (data.shiftStartToday !== null ? `Shift starts ${formatMinuteOfDay(data.shiftStartToday)} today` : undefined) : pending} icon={Fingerprint} />
        <StatCard label="Absent / on leave" value={at ? at.absent + at.onLeave : "—"} hint={at ? "Confirmed after the shift" : pending} icon={CalendarX} tone="danger" />
        <StatCard label="Pending leave approvals" value={pendingLeave} hint={pendingLeave ? "Review in Leave → Approvals" : "Nothing waiting"} icon={FileClock} tone="info" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Headcount by department</CardTitle>
            <CardDescription>Active employees</CardDescription>
          </CardHeader>
          <CardContent>
            {data.headcountByDepartment.length ? (
              <HeadcountChart data={data.headcountByDepartment} />
            ) : (
              <EmptyState
                title="No employees yet"
                description="Add employees to see headcount."
                action={can(actor, "employee.manage", "all") ? <Button asChild size="sm"><Link href="/employees/new">Add employee</Link></Button> : undefined}
              />
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Cake className="size-4" /> Birthdays today</CardTitle>
            </CardHeader>
            <CardContent>
              {data.birthdaysToday.length ? (
                <PeopleList people={data.birthdaysToday.map((p) => ({ ...p, meta: p.department?.name ?? "" }))} />
              ) : (
                <p className="text-sm text-muted-foreground">No birthdays today.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PartyPopper className="size-4" /> Work anniversaries</CardTitle>
              <CardDescription>Next 30 days</CardDescription>
            </CardHeader>
            <CardContent>
              {data.anniversaries.length ? (
                <PeopleList people={data.anniversaries.map((p) => ({ ...p, meta: `${formatDate(p.date)} · ${p.years} year${p.years === 1 ? "" : "s"}` }))} />
              ) : (
                <p className="text-sm text-muted-foreground">No upcoming anniversaries.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function PeopleList({ people }: { people: { id: string; fullName: string; employeeCode: string; meta: string }[] }) {
  return (
    <ul className="grid gap-3">
      {people.map((p) => (
        <li key={p.id}>
          <Link href={`/employees/${p.id}`} className="flex items-center gap-3 rounded-md hover:bg-muted/60">
            <Avatar className="size-8"><AvatarFallback className="text-xs">{initials(p.fullName)}</AvatarFallback></Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.fullName}</span>
              <span className="block truncate text-xs text-muted-foreground">{p.meta || p.employeeCode}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
