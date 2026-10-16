import Link from "next/link";
import { can, requirePagePermission } from "@/server/auth/session";
import { listRuns, monthName } from "@/server/services/payroll";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { formatDateTime, formatPKR } from "@/lib/format";
import { todayInPKT } from "@/lib/dates";
import { PrepareForm } from "./prepare-form";
import { PayrollStatusBadge } from "./status-badge";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";

export const metadata = { title: "Payroll" };

export default async function PayrollPage() {
  const actor = await requirePagePermission("payroll.read", "all");
  const runs = await listRuns(actor);
  const today = todayInPKT();
  // Current month and the five before it.
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return { value: `${y}-${String(m).padStart(2, "0")}`, label: monthName(y, m), exists: runs.some((r) => r.year === y && r.month === m) };
  });

  return (
    <>
      <PageHeader title="Payroll" description="Monthly payroll calculated from approved salaries and machine attendance. HR prepares, Finance approves." />

      {can(actor, "payroll.prepare", "all") && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Prepare payroll</CardTitle>
            <CardDescription>
              Rules: per-day rate = monthly salary ÷ days in month · each absent day = 1 day · every 3 late arrivals or missing punches = 1 day ·
              overtime not paid · no tax. Days without machine data are flagged, never deducted.
            </CardDescription>
          </CardHeader>
          <CardContent><PrepareForm months={months} /></CardContent>
        </Card>
      )}

      <PrivacyGroup>
      {runs.length > 0 && <div className="mb-2 flex justify-end"><PrivacyToggle /></div>}
      {runs.length === 0 ? (
        <EmptyState title="No payroll yet" description="Prepare the first month to see each employee's calculated pay." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead><TableHead>Status</TableHead>
                <TableHead className="text-right">Employees</TableHead><TableHead className="text-right">Total net pay</TableHead>
                <TableHead className="hidden md:table-cell">Last calculated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link href={`/payroll/${r.id}`} className="font-medium hover:underline">{r.label}</Link></TableCell>
                  <TableCell><PayrollStatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{r.employees}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums"><PrivateAmount value={formatPKR(r.totalNet)} /></TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{formatDateTime(r.calculatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      </PrivacyGroup>
    </>
  );
}
