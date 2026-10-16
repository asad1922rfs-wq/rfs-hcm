import { can, requirePagePermission } from "@/server/auth/session";
import { employeeFormOptions, suggestEmployeeCode } from "@/server/services/employees";
import { PageHeader } from "@/components/common";
import { toDateOnlyString, todayInPKT } from "@/lib/dates";
import { createEmployeeAction } from "../actions";
import { EmployeeForm } from "../employee-form";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const actor = await requirePagePermission("employee.manage", "all");
  const [options, employeeCode] = await Promise.all([employeeFormOptions(), suggestEmployeeCode()]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Add employee" description="Fields marked * are required." />
      <EmployeeForm
        mode="create"
        action={createEmployeeAction}
        options={options}
        defaults={{ employeeCode, joiningDate: toDateOnlyString(todayInPKT()), employmentType: "PERMANENT" }}
        canSetSalary={can(actor, "salary.manage", "all")}
        canSetBank={can(actor, "bank.manage", "all")}
        cancelHref="/employees"
      />
    </div>
  );
}
