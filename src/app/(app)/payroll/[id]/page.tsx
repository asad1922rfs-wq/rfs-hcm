import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Download, FileText, Users, Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth/session";
import { getRun } from "@/server/services/payroll";
import { NotFoundError } from "@/server/errors";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, StatCard } from "@/components/common";
import { formatDateTime, formatPKR } from "@/lib/format";
import { PayrollStatusBadge } from "../status-badge";
import { WorkflowBar } from "./workflow-bar";
import { ItemDialog, type ItemView } from "./item-dialog";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";
import { asStringArray } from "@/server/json-fields";

export const metadata = { title: "Payroll" };

export default async function PayrollRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; issues?: string }> }) {
  const actor = await requirePagePermission("payroll.read", "all");
  const { id } = await params;
  const sp = await searchParams;
  const run = await getRun(actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });

  const items: ItemView[] = run.items.map((i) => ({
    id: i.id, employeeCode: i.employeeCode, fullName: i.fullName, department: i.department, designation: i.designation,
    grossSalary: Number(i.grossSalary), perDayRate: Number(i.perDayRate), daysInMonth: i.daysInMonth, employedDays: i.employedDays,
    presentDays: i.presentDays, absentDays: i.absentDays, lateCount: i.lateCount, missingPunchCount: i.missingPunchCount,
    lateDeductionDays: i.lateDeductionDays, notSyncedDays: i.notSyncedDays, earnings: Number(i.earnings), deductions: Number(i.deductions),
    netPay: Number(i.netPay), lines: i.lines as ItemView["lines"], warnings: asStringArray(i.warnings),
    adjustments: i.adjustments.map((a) => ({ id: a.id, kind: a.kind, label: a.label, amount: Number(a.amount) })),
  }));
  const q = sp.q?.trim().toLowerCase();
  const shown = items.filter((i) => (!q || i.fullName.toLowerCase().includes(q) || i.employeeCode.toLowerCase().includes(q)) && (!sp.issues || i.warnings.length > 0));
  const totals = items.reduce((t, i) => ({ gross: t.gross + i.earnings, deductions: t.deductions + i.deductions, net: t.net + i.netPay }), { gross: 0, deductions: 0, net: 0 });
  const withWarnings = items.filter((i) => i.warnings.length > 0).length;
  const canPrepare = can(actor, "payroll.prepare", "all");
  const editable = run.status === "DRAFT" && canPrepare;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2"><Link href="/payroll"><ArrowLeft className="size-4" /> All payrolls</Link></Button>
      <PageHeader
        title={`Payroll · ${run.label}`}
        description={[
          `Prepared by ${run.preparedBy ?? "—"}`,
          run.submittedBy && `submitted by ${run.submittedBy} ${formatDateTime(run.submittedAt)}`,
          run.approvedBy && `approved by ${run.approvedBy} ${formatDateTime(run.approvedAt)}`,
          `calculated ${formatDateTime(run.calculatedAt)}`,
        ].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <PayrollStatusBadge status={run.status} />
            <Button asChild variant="outline"><a href={`/api/v1/payroll/${run.id}/export`}><Download className="size-4" /> Excel</a></Button>
            {(run.status === "APPROVED" || run.status === "PAID") && can(actor, "payslip.read", "all") && (
              <Button asChild><a href={`/api/v1/payroll/${run.id}/payslips`} target="_blank" rel="noopener"><FileText className="size-4" /> All payslips (PDF)</a></Button>
            )}
          </div>
        }
      />

      {run.rejectedNote && run.status === "DRAFT" && (
        <Alert variant="destructive" className="mb-4"><AlertDescription><strong>Sent back by Finance:</strong> {run.rejectedNote}</AlertDescription></Alert>
      )}

      <div className="mb-4">
        <WorkflowBar
          runId={run.id}
          status={run.status}
          canPrepare={canPrepare}
          canApprove={can(actor, "payroll.approve", "all")}
          submittedByMe={run.submittedById === actor.userId}
          warningsCount={withWarnings}
        />
      </div>

      <PrivacyGroup>
      <div className="mb-2 flex justify-end"><PrivacyToggle /></div>
      <section className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Employees" value={items.length} icon={Users} />
        <StatCard label="Gross earnings" value={<PrivateAmount value={formatPKR(totals.gross)} />} icon={Wallet} />
        <StatCard label="Deductions" value={<PrivateAmount value={formatPKR(totals.deductions)} />} tone="danger" icon={Wallet} />
        <StatCard label="Net payable" value={<PrivateAmount value={formatPKR(totals.net)} />} tone="success" icon={Wallet} />
      </section>

      <form className="mb-3 flex flex-wrap items-center gap-3" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Search name or ID" className="h-9 w-60 rounded-md border bg-transparent px-3 text-sm" aria-label="Search employee" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="issues" value="1" defaultChecked={!!sp.issues} /> Only with warnings ({withWarnings})
        </label>
        <Button type="submit" variant="secondary" size="sm">Filter</Button>
      </form>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead className="text-right">Salary</TableHead>
              <TableHead className="hidden md:table-cell text-right">Absent</TableHead>
              <TableHead className="hidden md:table-cell text-right">Late + missing</TableHead>
              <TableHead className="text-right">Deductions</TableHead>
              <TableHead className="text-right">Net pay</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <span className="flex items-center gap-1.5 font-medium">
                    {i.fullName}
                    {i.warnings.length > 0 && <AlertTriangle className="size-3.5 text-warning" aria-label={`${i.warnings.length} warning(s)`} />}
                  </span>
                  <span className="block text-xs text-muted-foreground">{i.employeeCode}{i.department ? ` · ${i.department}` : ""}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums"><PrivateAmount value={formatPKR(i.grossSalary)} /></TableCell>
                <TableCell className="hidden md:table-cell text-right tabular-nums">{i.absentDays || "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-right tabular-nums">
                  {i.lateCount + i.missingPunchCount || "—"}{i.lateDeductionDays > 0 && <span className="text-xs text-muted-foreground"> → {i.lateDeductionDays}d</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{i.deductions ? formatPKR(i.deductions) : "—"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums"><PrivateAmount value={formatPKR(i.netPay)} /></TableCell>
                <TableCell className="text-right"><ItemDialog runId={run.id} item={i} editable={editable} payslipReady={run.status === "APPROVED" || run.status === "PAID"} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      </PrivacyGroup>
    </>
  );
}
