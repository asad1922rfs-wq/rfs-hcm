import Link from "next/link";
import { Plus, Search, Upload, Wallet } from "lucide-react";
import type { EmploymentStatus } from "@prisma/client";
import { can, requirePagePermission } from "@/server/auth/session";
import { listEmployees } from "@/server/services/employees";
import { listDepartments } from "@/server/services/organisation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, humanize, PageHeader } from "@/components/common";
import { NativeSelect } from "@/components/form";
import { formatDate } from "@/lib/format";
import { EMPLOYMENT_STATUSES } from "@/lib/validation";
import { EmployeeTable } from "./employee-table";

export const metadata = { title: "Employees" };

type Search = { q?: string; department?: string; status?: string; page?: string };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const actor = await requirePagePermission("employee.read", "team");
  const sp = await searchParams;
  const status = (EMPLOYMENT_STATUSES as readonly string[]).includes(sp.status ?? "") || sp.status === "ALL"
    ? (sp.status as EmploymentStatus | "ALL")
    : undefined;

  const [result, departments] = await Promise.all([
    listEmployees(actor, { q: sp.q, departmentId: sp.department || undefined, status, page: Number(sp.page) || 1 }),
    listDepartments(),
  ]);
  const canManage = can(actor, "employee.manage", "all");

  const pageHref = (page: number) => {
    const params = new URLSearchParams(Object.entries({ ...sp, page: String(page) }).filter(([, v]) => v) as [string, string][]);
    return `/employees?${params}`;
  };

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${result.total} ${status === "ALL" ? "total" : humanize(status ?? "ACTIVE").toLowerCase()} employee${result.total === 1 ? "" : "s"}`}
        actions={
          canManage && (
            <>
              <Button asChild variant="outline"><Link href="/employees/import"><Upload /> Import from Excel</Link></Button>
              {can(actor, "salary.manage", "all") && (
                <Button asChild variant="outline"><Link href="/employees/import-salaries"><Wallet /> Import salaries</Link></Button>
              )}
              <Button asChild><Link href="/employees/new"><Plus /> Add employee</Link></Button>
            </>
          )
        }
      />

      <form className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_160px_auto]" role="search">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={sp.q} placeholder="Search name, Employee ID, email, phone" className="pl-9" aria-label="Search employees" />
        </div>
        <NativeSelect name="department" defaultValue={sp.department ?? ""} aria-label="Department">
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={sp.status ?? "ACTIVE"} aria-label="Status">
          {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          <option value="ALL">All statuses</option>
        </NativeSelect>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>

      {result.rows.length === 0 ? (
        <EmptyState
          title="No employees found"
          description={sp.q || sp.department ? "Try a different search or filter." : "Employees you add will appear here."}
          action={canManage && !sp.q ? <Button asChild size="sm"><Link href="/employees/new">Add employee</Link></Button> : undefined}
        />
      ) : (
        <EmployeeTable
          canDelete={can(actor, "employee.delete", "all")}
          selfId={actor.employeeId}
          rows={result.rows.map((e) => ({
            id: e.id, employeeCode: e.employeeCode, fullName: e.fullName, department: e.department?.name ?? null,
            designation: e.designation?.title ?? null, joined: formatDate(e.joiningDate), employmentType: e.employmentType, status: e.status,
          }))}
        />
      )}

      {result.pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted-foreground">Page {result.page} of {result.pageCount}</span>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm" disabled={result.page <= 1}>
              <Link href={pageHref(Math.max(1, result.page - 1))} aria-disabled={result.page <= 1}>Previous</Link>
            </Button>
            <Button asChild variant="outline" size="sm" disabled={result.page >= result.pageCount}>
              <Link href={pageHref(Math.min(result.pageCount, result.page + 1))} aria-disabled={result.page >= result.pageCount}>Next</Link>
            </Button>
          </div>
        </nav>
      )}
    </>
  );
}
