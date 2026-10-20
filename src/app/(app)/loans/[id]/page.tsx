import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, HandCoins, Hourglass, Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth/session";
import { getLoan, loanMonthLabel } from "@/server/services/loans";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailList, EmptyState, StatCard } from "@/components/common";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";
import { formatDate, formatDateTime, formatPKR } from "@/lib/format";
import { toDateOnlyString, todayInPKT } from "@/lib/dates";
import { CancelLoanButton, CashRepaymentDialog, DecideLoanButtons, MonthInstallmentField } from "../loans-client";
import { LoanStatusBadge } from "../status-badge";

export const metadata = { title: "Loan" };

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("loan.read", "self");
  const { id } = await params;
  const loan = await getLoan(actor, id).catch((err) => {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  });
  const canManage = can(actor, "loan.manage", "all");
  const running = loan.status === "APPROVED";
  const manageSchedule = canManage && running && !loan.isOwn;
  const today = toDateOnlyString(todayInPKT());

  return (
    <PrivacyGroup>
      <Link href="/loans" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Loans</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            Loan · {loan.employee.fullName} <LoanStatusBadge status={loan.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loan.employee.employeeCode}{loan.employee.department ? ` · ${loan.employee.department.name}` : ""} · given {formatDate(loan.givenOn ?? loan.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrivacyToggle className="h-9" />
          {canManage && loan.status === "PENDING" && !loan.isOwn && (
            <DecideLoanButtons id={loan.id} name={loan.employee.fullName} />
          )}
          {canManage && running && <CashRepaymentDialog id={loan.id} outstanding={loan.outstanding} today={today} />}
          {manageSchedule && <CancelLoanButton id={loan.id} running label="Cancel loan" />}
          {loan.status === "PENDING" && loan.isOwn && <CancelLoanButton id={loan.id} running={false} label="Withdraw request" />}
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Loan amount" value={<PrivateAmount value={formatPKR(loan.amount)} />} hint={`Given ${formatDate(loan.givenOn ?? loan.createdAt)}`} icon={HandCoins} />
        <StatCard label="Repaid" value={<PrivateAmount value={formatPKR(loan.repaid)} />} icon={Wallet} tone="success" />
        <StatCard label={loan.status === "CANCELLED" ? "Written off" : "Outstanding"} value={<PrivateAmount value={formatPKR(loan.status === "CANCELLED" ? loan.amount - loan.repaid : loan.outstanding)} />} icon={HandCoins} tone="warning" />
        <StatCard
          label="Next deduction"
          value={loan.next ? <PrivateAmount value={formatPKR(loan.next.amount)} /> : "—"}
          hint={loan.next ? `${loanMonthLabel(loan.next.year, loan.next.month)} payroll · capped so net pay stays above zero` : running ? "Nothing to deduct — no amount entered" : undefined}
          icon={Hourglass}
          tone="info"
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4"><CardTitle>Monthly installments</CardTitle></CardHeader>
          {loan.months.length === 0 ? (
            <CardContent className="py-6"><EmptyState title="Nothing yet" description={running ? "No repayments yet." : "This loan has no repayments."} /></CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Payroll</TableHead>
                  <TableHead className="text-right">Cash</TableHead>
                  <TableHead className="text-right">Installment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.months.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="whitespace-nowrap">{r.label}</TableCell>
                    <TableCell className="text-right">{r.payroll ? <PrivateAmount value={formatPKR(r.payroll)} /> : "—"}</TableCell>
                    <TableCell className="text-right">{r.cash ? <PrivateAmount value={formatPKR(r.cash)} /> : "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        {r.open && <InstallmentText r={r} />}
                        {manageSchedule && r.open ? (
                          <MonthInstallmentField id={loan.id} month={r.key} label={r.label} entered={r.entered} placeholder={r.effective ? String(r.effective) : "0"} max={loan.outstanding} />
                        ) : !r.open && r.entered ? (
                          <PrivateAmount value={formatPKR(r.entered)} />
                        ) : !r.open ? (
                          "—"
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            The installment entered for a month is deducted from that month&apos;s payroll. Not entered = repeats the last amount; enter 0 to skip a month. It is never more than the balance, and if net pay is too low the shortfall stays outstanding. Payroll deductions are recorded when the month&apos;s payroll is approved.
          </p>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: "Reason", value: <span className="whitespace-pre-line">{loan.reason}</span> },
                  { label: "Date given", value: formatDate(loan.givenOn ?? loan.createdAt) },
                  { label: "Requested by", value: loan.requestedBy },
                  ...(loan.decidedAt ? [{ label: loan.status === "REJECTED" ? "Rejected by" : "Approved by", value: `${loan.decidedBy ?? "—"} · ${formatDateTime(loan.decidedAt)}` }] : []),
                  ...(loan.decisionNote ? [{ label: "Decision note", value: loan.decisionNote }] : []),
                  ...(loan.cancelledAt ? [{ label: "Cancelled", value: `${loan.cancelledBy ?? "—"} · ${formatDateTime(loan.cancelledAt)}` }] : []),
                  ...(loan.cancelNote ? [{ label: "Cancellation note", value: loan.cancelNote }] : []),
                ]}
              />
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4"><CardTitle>Repayments</CardTitle></CardHeader>
            {loan.repayments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No repayments yet.</p>
            ) : (
              <ul>
                {loan.repayments.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 border-b px-4 py-2.5 text-sm last:border-b-0">
                    <span>
                      {r.source === "PAYROLL" ? `Payroll · ${r.monthLabel}` : `Cash · ${formatDate(r.paidOn)}`}
                      {(r.note && r.source === "CASH") || r.by ? (
                        <span className="block text-xs text-muted-foreground">{[r.source === "CASH" ? r.note : null, r.by].filter(Boolean).join(" · ")}</span>
                      ) : null}
                    </span>
                    <PrivateAmount value={formatPKR(r.amount)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </PrivacyGroup>
  );
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** What an open month will deduct: an entry, a skip, or the repeated default (muted). */
function InstallmentText({ r }: { r: { entered: number | null; effective: number; repeatsFrom: string | null } }) {
  if (r.entered === 0) return <span className="text-muted-foreground">Skipped</span>;
  if (r.entered !== null) return <PrivateAmount value={formatPKR(r.effective)} />;
  if (r.effective > 0 && r.repeatsFrom) {
    return (
      <span className="text-muted-foreground">
        <PrivateAmount value={formatPKR(r.effective)} /> (repeats {MONTH_SHORT[Number(r.repeatsFrom.slice(5, 7)) - 1]})
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}
