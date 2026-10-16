import { FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/common";
import { formatPKR } from "@/lib/format";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";

export type PayslipRow = { id: string; label: string; netPay: number; status: string; deductions: number; earnings: number };

/** Approved payslips with PDF links (used on /payslips and the employee profile). */
export function PayslipList({ rows }: { rows: PayslipRow[] }) {
  if (rows.length === 0) return <EmptyState title="No payslips yet" description="Payslips appear here once a month's payroll is approved by Finance." />;
  return (
    <PrivacyGroup>
    <div className="mb-2 flex justify-end"><PrivacyToggle /></div>
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Earnings</TableHead>
            <TableHead className="text-right">Deductions</TableHead>
            <TableHead className="text-right">Net pay</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell className="text-right tabular-nums"><PrivateAmount value={formatPKR(r.earnings)} /></TableCell>
              <TableCell className="text-right tabular-nums"><PrivateAmount value={formatPKR(r.deductions)} /></TableCell>
              <TableCell className="text-right font-semibold tabular-nums"><PrivateAmount value={formatPKR(r.netPay)} /></TableCell>
              <TableCell>{r.status === "PAID" ? "Paid" : "Approved"}</TableCell>
              <TableCell className="text-right">
                <a href={`/api/v1/payslips/${r.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                  <FileText className="size-4" /> View / print
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
    </PrivacyGroup>
  );
}
