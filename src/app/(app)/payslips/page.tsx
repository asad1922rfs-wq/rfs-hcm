import Link from "next/link";
import { can, requirePagePermission } from "@/server/auth/session";
import { employeePayHistory } from "@/server/services/payroll";
import { EmptyState, PageHeader } from "@/components/common";
import { PayslipList } from "./payslip-list";

export const metadata = { title: "Payslips" };

export default async function PayslipsPage() {
  const actor = await requirePagePermission("payslip.read", "self");
  const history = actor.employeeId ? await employeePayHistory(actor.employeeId) : [];

  return (
    <>
      <PageHeader title="My payslips" description="Approved monthly payslips. Open one to view, print or save it as PDF." />
      {actor.employeeId ? (
        <PayslipList
          rows={history.map((h) => ({ id: h.id, label: h.label, netPay: Number(h.netPay), status: h.run.status, deductions: Number(h.deductions), earnings: Number(h.earnings) }))}
        />
      ) : (
        <EmptyState title="Your account is not linked to an employee" />
      )}
      {can(actor, "payslip.read", "all") && (
        <p className="mt-6 text-sm text-muted-foreground">
          Payslips for all employees are on each approved month in{" "}
          <Link href="/payroll" className="font-medium text-primary hover:underline">Payroll</Link> (one PDF per employee, or all in one file).
        </p>
      )}
    </>
  );
}
