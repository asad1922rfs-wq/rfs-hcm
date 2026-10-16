import { requirePagePermission } from "@/server/auth/session";
import { listDepartments, listDesignations } from "@/server/services/organisation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { saveDepartmentAction, saveDesignationAction } from "../actions";
import { RecordDialog } from "../record-dialog";

export const metadata = { title: "Departments & designations" };

export default async function OrganisationPage() {
  await requirePagePermission("settings.organisation", "all");
  const [departments, designations] = await Promise.all([listDepartments(), listDesignations()]);

  return (
    <>
      <PageHeader title="Departments & designations" description="Used on employee profiles, filters and department reports." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Departments</CardTitle>
            <RecordDialog
              title="Add department"
              trigger="Add"
              triggerVariant="default"
              action={saveDepartmentAction}
              fields={[
                { kind: "text", name: "name", label: "Name", required: true },
                { kind: "text", name: "code", label: "Code", hint: "Optional short code, e.g. ENG" },
                { kind: "text", name: "description", label: "Description" },
                { kind: "checkbox", name: "isActive", label: "Active", defaultChecked: true },
              ]}
            />
          </CardHeader>
          <CardContent>
            {departments.length === 0 ? (
              <EmptyState title="No departments yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Name</TableHead><TableHead>Code</TableHead><TableHead className="text-right">Employees</TableHead><TableHead /></TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((d) => (
                    <TableRow key={d.id} className={d.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell className="font-medium">{d.name}{!d.isActive && " (inactive)"}</TableCell>
                      <TableCell>{d.code ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{d._count.employees}</TableCell>
                      <TableCell className="text-right">
                        <RecordDialog
                          title="Edit department"
                          trigger="Edit"
                          triggerVariant="ghost"
                          id={d.id}
                          action={saveDepartmentAction}
                          fields={[
                            { kind: "text", name: "name", label: "Name", required: true, defaultValue: d.name },
                            { kind: "text", name: "code", label: "Code", defaultValue: d.code ?? "" },
                            { kind: "text", name: "description", label: "Description", defaultValue: d.description ?? "" },
                            { kind: "checkbox", name: "isActive", label: "Active", defaultChecked: d.isActive },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Designations</CardTitle>
            <RecordDialog
              title="Add designation"
              trigger="Add"
              triggerVariant="default"
              action={saveDesignationAction}
              fields={[
                { kind: "text", name: "title", label: "Title", required: true },
                { kind: "checkbox", name: "isActive", label: "Active", defaultChecked: true },
              ]}
            />
          </CardHeader>
          <CardContent>
            {designations.length === 0 ? (
              <EmptyState title="No designations yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Title</TableHead><TableHead className="text-right">Employees</TableHead><TableHead /></TableRow>
                </TableHeader>
                <TableBody>
                  {designations.map((d) => (
                    <TableRow key={d.id} className={d.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell className="font-medium">{d.title}{!d.isActive && " (inactive)"}</TableCell>
                      <TableCell className="text-right tabular-nums">{d._count.employees}</TableCell>
                      <TableCell className="text-right">
                        <RecordDialog
                          title="Edit designation"
                          trigger="Edit"
                          triggerVariant="ghost"
                          id={d.id}
                          action={saveDesignationAction}
                          fields={[
                            { kind: "text", name: "title", label: "Title", required: true, defaultValue: d.title },
                            { kind: "checkbox", name: "isActive", label: "Active", defaultChecked: d.isActive },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
