import { requirePagePermission } from "@/server/auth/session";
import { PageHeader } from "@/components/common";
import { SalaryImport } from "./salary-import-client";

export const metadata = { title: "Import salaries" };

export default async function ImportSalariesPage() {
  await requirePagePermission("salary.manage", "all");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Import salaries"
        description="Set monthly basic salary and fixed allowances for many employees at once. Every change is recorded in the audit log."
      />
      <SalaryImport />
    </div>
  );
}
