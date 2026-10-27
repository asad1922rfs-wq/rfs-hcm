import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/session";
import { employeeFormOptions, getEmployeeProfile } from "@/server/services/employees";
import { NotFoundError } from "@/server/errors";
import { PageHeader } from "@/components/common";
import { toDateOnlyString } from "@/lib/dates";
import { updateEmployeeAction } from "../../actions";
import { EmployeeForm } from "../../employee-form";

export const metadata = { title: "Edit employee" };

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("employee.manage", "all");
  const { id } = await params;
  const profile = await getEmployeeProfile(actor, id).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const e = profile.employee;
  const options = await employeeFormOptions();

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${e.fullName}`} description={e.employeeCode} />
      <EmployeeForm
        mode="edit"
        action={updateEmployeeAction.bind(null, id)}
        options={options}
        excludeManagerId={id}
        cancelHref={`/employees/${id}`}
        defaults={{
          employeeCode: e.employeeCode,
          fullName: e.fullName,
          email: e.email ?? "",
          phone: e.phone ?? "",
          gender: e.gender ?? "",
          dateOfBirth: e.dateOfBirth ? toDateOnlyString(e.dateOfBirth) : "",
          cnic: e.cnic ?? "",
          address: e.address ?? "",
          joiningDate: toDateOnlyString(e.joiningDate),
          employmentType: e.employmentType,
          departmentId: e.departmentId ?? "",
          designationId: e.designationId ?? "",
          shiftId: e.shiftId ?? "",
          managerId: e.managerId ?? "",
          deviceUserId: e.deviceUserId ?? "",
          workMode: e.workMode,
          flexibleFrom: e.flexibleFrom ? toDateOnlyString(e.flexibleFrom) : "",
          contacts: e.emergencyContacts.map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone })),
        }}
      />
    </div>
  );
}
