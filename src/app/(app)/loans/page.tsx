import Link from "next/link";
import { HandCoins, Hourglass, Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { firstOpenPayrollMonth, listLoans, loanMonthLabel, myLoans, pendingLoanCount, type LoanRow, type LoanView } from "@/server/services/loans";
import { monthKey } from "@/core/loans/schedule";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader, StatCard } from "@/components/common";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";
import { formatDate, formatPKR } from "@/lib/format";
import { todayInPKT } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DecideLoanButtons, LoanFormDialog } from "./loans-client";
import { LoanStatusBadge } from "./status-badge";

export const metadata = { title: "Loans" };

function LoansTable({ rows, showEmployee, actions }: { rows: LoanRow[]; showEmployee?: boolean; actions?: (r: LoanRow) => React.ReactNode }) {
  if (rows.length === 0) return <EmptyState title="Nothing here" />;
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            {showEmployee && <TableHead>Employee</TableHead>}
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="hidden sm:table-cell">Installments</TableHead>
            <TableHead className="hidden md:table-cell">First deduction</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead className="hidden lg:table-cell">Next deduction</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} className="align-top">
              {showEmployee && (
                <TableCell>
                  <Link href={`/loans/${r.id}`} className="font-medium hover:underline">{r.employee.fullName}</Link>
                  <span className="block text-xs text-muted-foreground">{r.employee.employeeCode}{r.employee.department ? ` · ${r.employee.department.name}` : ""}</span>
                </TableCell>
              )}
              <TableCell className="text-right">
                <PrivateAmount value={formatPKR(r.amount)} />
                <span className="block text-xs text-muted-foreground">{formatDate(r.createdAt)}</span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {r.installments} × <PrivateAmount value={formatPKR(r.installmentAmount)} />
                {r.lastInstallment !== r.installmentAmount && <span className="block text-xs text-muted-foreground">last <PrivateAmount value={formatPKR(r.lastInstallment)} /></span>}
              </TableCell>
              <TableCell className="hidden whitespace-nowrap md:table-cell">{r.startLabel}</TableCell>
              <TableCell className="text-right"><PrivateAmount value={formatPKR(r.outstanding)} /></TableCell>
              <TableCell className="hidden whitespace-nowrap lg:table-cell">
                {r.next ? <>{loanMonthLabel(r.next.year, r.next.month)} · <PrivateAmount value={formatPKR(r.next.amount)} /></> : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <LoanStatusBadge status={r.status} />
                {(r.cancelNote ?? r.decisionNote) && r.status !== "APPROVED" && <span className="mt-1 block max-w-48 text-xs text-muted-foreground">{r.cancelNote ?? r.decisionNote}</span>}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  {actions?.(r)}
                  <Link href={`/loans/${r.id}`} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium hover:bg-accent">Details</Link>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default async function LoansPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requirePagePermission("loan.read", "self");
  const sp = await searchParams;
  const canManage = can(actor, "loan.manage", "all");
  const canSeeOthers = can(actor, "loan.read", "team");
  const canRequest = !!actor.employeeId && can(actor, "loan.request", "self");
  const hasOwn = !!actor.employeeId;

  const views: { key: "mine" | LoanView; label: string }[] = [
    ...(hasOwn ? [{ key: "mine" as const, label: "My loans" }] : []),
    ...(canManage ? [{ key: "pending" as const, label: "Pending requests" }] : []),
    ...(canSeeOthers ? [{ key: "active" as const, label: canManage ? "Active" : "Team · active" }, { key: "closed" as const, label: "Completed & other" }] : []),
  ];
  const view = views.find((v) => v.key === sp.view)?.key ?? views[0]?.key ?? "mine";

  const today = todayInPKT();
  const open = await firstOpenPayrollMonth();
  const current = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
  const minMonth = monthKey(open.year, open.month);
  const defaultMonth = [minMonth, monthKey(current.year, current.month)].sort().at(-1)!;

  const [mine, rows, pendingCount] = await Promise.all([
    view === "mine" ? myLoans(actor) : Promise.resolve([]),
    view !== "mine" ? listLoans(actor, view) : Promise.resolve([]),
    pendingLoanCount(actor),
  ]);
  const employees = canManage
    ? (await db.employee.findMany({
        where: { status: "ACTIVE", ...(actor.employeeId ? { NOT: { id: actor.employeeId } } : {}) },
        orderBy: { fullName: "asc" },
        select: { id: true, fullName: true, employeeCode: true },
      })).map((e) => ({ id: e.id, label: `${e.fullName} (${e.employeeCode})` }))
    : undefined;

  const tab = (v: string, label: string, count?: number) => (
    <Link
      key={v}
      href={`/loans?view=${v}`}
      aria-current={view === v ? "page" : undefined}
      className={cn("-mb-px rounded-t-md border border-b-0 px-4 py-2 text-xs font-semibold uppercase tracking-wide", view === v ? "border-border bg-card text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      {label}{count ? <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{count}</span> : null}
    </Link>
  );

  const running = mine.filter((l) => l.status === "APPROVED");

  return (
    <PrivacyGroup>
      <PageHeader
        title="Loans"
        description="Interest-free salary advances, repaid by fixed monthly installments deducted in payroll. Repayments are recorded when the month's payroll is approved."
        actions={
          <>
            <PrivacyToggle className="h-9" />
            {employees && <LoanFormDialog employees={employees} minMonth={minMonth} defaultMonth={defaultMonth} trigger="Add loan" />}
            {canRequest && <LoanFormDialog minMonth={minMonth} defaultMonth={defaultMonth} trigger="Request a loan" />}
          </>
        }
      />
      {views.length > 1 && <nav className="mb-5 flex flex-wrap gap-1 border-b">{views.map((v) => tab(v.key, v.label, v.key === "pending" ? pendingCount : undefined))}</nav>}

      {view === "mine" && (
        <div className="grid gap-6">
          {running.length > 0 && (
            <section className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Outstanding balance" value={<PrivateAmount value={formatPKR(running.reduce((s, l) => s + l.outstanding, 0))} />} icon={HandCoins} tone="warning" hint={`${running.length} running loan${running.length === 1 ? "" : "s"}`} />
              <StatCard label="Repaid so far" value={<PrivateAmount value={formatPKR(running.reduce((s, l) => s + l.repaid, 0))} />} icon={Wallet} tone="success" />
              {(() => {
                const next = running.map((l) => l.next).filter((n): n is NonNullable<typeof n> => !!n).sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))[0];
                const total = next ? running.filter((l) => l.next?.year === next.year && l.next.month === next.month).reduce((s, l) => s + l.next!.amount, 0) : 0;
                return <StatCard label="Next deduction" value={next ? <PrivateAmount value={formatPKR(total)} /> : "—"} hint={next ? `${loanMonthLabel(next.year, next.month)} salary` : "Nothing scheduled"} icon={Hourglass} tone="info" />;
              })()}
            </section>
          )}
          {mine.length === 0 ? (
            <EmptyState
              title="No loans"
              description={canRequest ? "Need a salary advance? Request a loan — it is repaid in monthly installments from your salary." : undefined}
            />
          ) : (
            <LoansTable rows={mine} />
          )}
        </div>
      )}

      {view === "pending" && (
        <LoansTable
          rows={rows}
          showEmployee
          actions={(r) => (r.employee.id === actor.employeeId ? <span className="self-center text-xs text-muted-foreground">Your request</span> : (
            <DecideLoanButtons id={r.id} name={r.employee.fullName} startMonth={monthKey(r.startYear, r.startMonth)} minMonth={minMonth} />
          ))}
        />
      )}

      {(view === "active" || view === "closed") && <LoansTable rows={rows} showEmployee />}
    </PrivacyGroup>
  );
}
