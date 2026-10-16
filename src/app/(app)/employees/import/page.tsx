import { requirePagePermission } from "@/server/auth/session";
import { PageHeader } from "@/components/common";
import { EmployeeImport } from "./import-client";

export const metadata = { title: "Import employees" };

export default async function ImportEmployeesPage() {
  await requirePagePermission("employee.manage", "all");
  return (
    <>
      <PageHeader
        title="Import employees"
        description="Upload the FlowHCM EmployeeTemplate export. Preview shows every change and problem before anything is saved."
      />
      <EmployeeImport />
    </>
  );
}
