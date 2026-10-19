import { Download } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth/session";
import { attendanceSummaryRows, MAX_DAILY_RANGE_DAYS, payrollRunOptions, reportEmployeeOptions } from "@/server/services/reports";
import { listDepartments } from "@/server/services/organisation";
import { monthName } from "@/server/services/payroll";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, humanize, PageHeader } from "@/components/common";
import { Field, NativeSelect } from "@/components/form";
import { todayInPKT, toDateOnlyString } from "@/lib/dates";

export const metadata = { title: "Reports" };

const XLSX_HINT = "Excel (.xlsx) · times in Pakistan time";

function DepartmentSelect({ departments, defaultValue, id }: { departments: { id: string; name: string }[]; defaultValue?: string; id: string }) {
  return (
    <Field label="Department" name="department" id={id}>
      <NativeSelect id={id} name="department" defaultValue={defaultValue ?? ""}>
        <option value="">All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </NativeSelect>
    </Field>
  );
}

function DownloadButton() {
  return <Button type="submit" className="w-full sm:w-auto"><Download /> Download</Button>;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string; department?: string }> }) {
  const actor = await requirePagePermission("report.read", "team");
  const sp = await searchParams;
  const today = todayInPKT();
  const todayIso = toDateOnlyString(today);
  const currentMonth = todayIso.slice(0, 7);
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : currentMonth;
  const year = Number(month.slice(0, 4));
  const monthNo = Number(month.slice(5, 7));
  const showPayroll = can(actor, "payroll.read", "all");
  const showLeave = can(actor, "leave.read", "team");

  const [departments, employees, runs] = await Promise.all([
    listDepartments(),
    reportEmployeeOptions(actor),
    showPayroll ? payrollRunOptions(actor) : [],
  ]);
  const department = departments.some((d) => d.id === sp.department) ? sp.department : undefined;
  const preview = await attendanceSummaryRows(actor, year, monthNo, department);

  return (
    <>
      <PageHeader title="Reports" description="Month-end reports for HR and Finance. Each download covers only the employees you are allowed to see." />

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly attendance summary</CardTitle>
            <CardDescription>
              Per employee: present, late, early, missing punch, absent, leave, worked hours, and deduction days: each absent day plus
              1 day for every 3 late arrivals or missing punches. {XLSX_HINT}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/v1/reports/attendance-summary" method="get" className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Month" name="month" id="sum-month" type="month" defaultValue={month} max={currentMonth} required />
              <DepartmentSelect departments={departments} defaultValue={department} id="sum-department" />
              <DownloadButton />
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Daily attendance detail</CardTitle>
            <CardDescription>
              One row per employee per day with status, check-in, check-out, worked time and late / early minutes. Up to {MAX_DAILY_RANGE_DAYS} days. {XLSX_HINT}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action="/api/v1/reports/attendance-daily" method="get" className="grid gap-4 sm:grid-cols-2">
              <Field label="From" name="from" id="daily-from" type="date" defaultValue={`${currentMonth}-01`} max={todayIso} required />
              <Field label="To" name="to" id="daily-to" type="date" defaultValue={todayIso} max={todayIso} required />
              <DepartmentSelect departments={departments} id="daily-department" />
              <Field label="Employee" name="employee" id="daily-employee">
                <NativeSelect id="daily-employee" name="employee" defaultValue="">
                  <option value="">All employees</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeCode})</option>)}
                </NativeSelect>
              </Field>
              <div className="sm:col-span-2"><DownloadButton /></div>
            </form>
          </CardContent>
        </Card>

        {showLeave && (
          <Card>
            <CardHeader>
              <CardTitle>Leave report</CardTitle>
              <CardDescription>Per employee and leave type for a calendar year: entitlement, approved days taken, pending requests and remaining balance. {XLSX_HINT}.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action="/api/v1/reports/leave" method="get" className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Year" name="year" id="leave-year" type="number" defaultValue={year} min={2000} max={today.getUTCFullYear() + 1} required />
                <DepartmentSelect departments={departments} id="leave-department" />
                <DownloadButton />
              </form>
            </CardContent>
          </Card>
        )}

        {showPayroll && (
          <Card>
            <CardHeader>
              <CardTitle>Payroll register &amp; bank transfer</CardTitle>
              <CardDescription>
                Every payslip with gross, each deduction and net pay, with totals, plus a bank transfer sheet.
                {can(actor, "bank.read", "all") ? " Full account numbers are included — the download is recorded in the audit log." : " Account numbers are masked to the last 4 digits."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payroll has been prepared yet.</p>
              ) : (
                <form action="/api/v1/reports/payroll-register" method="get" className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                  <Field label="Payroll" name="run" id="payroll-run">
                    <NativeSelect id="payroll-run" name="run" defaultValue={runs[0]!.id} required>
                      {runs.map((r) => <option key={r.id} value={r.id}>{r.label} — {humanize(r.status)}</option>)}
                    </NativeSelect>
                  </Field>
                  <DownloadButton />
                </form>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-4">
          <CardTitle>Attendance summary — {monthName(year, monthNo)}</CardTitle>
          <CardDescription>Preview of the monthly summary. Present includes late, early, half / short days and missing punches.</CardDescription>
          <form className="mt-3 flex flex-wrap items-center gap-2" role="search">
            <input type="month" name="month" defaultValue={month} max={currentMonth} className="h-9 rounded-md border bg-transparent px-3 text-sm" aria-label="Month" />
            <NativeSelect name="department" defaultValue={department ?? ""} className="w-48" aria-label="Department">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
            <Button type="submit" variant="secondary">Show</Button>
          </form>
        </CardHeader>
        {preview.length === 0 ? (
          <CardContent className="pb-6"><EmptyState title="No employees for this month" /></CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="text-right">Present</TableHead>
                <TableHead className="text-right">Late</TableHead>
                <TableHead className="text-right">Early</TableHead>
                <TableHead className="text-right">Missing</TableHead>
                <TableHead className="text-right">Absent</TableHead>
                <TableHead className="text-right">Leave</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Worked h</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Late min</TableHead>
                <TableHead className="text-right">Late + missing</TableHead>
                <TableHead className="text-right">Late deduction</TableHead>
                <TableHead className="text-right">Total deduction days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((r) => (
                <TableRow key={r.employeeId}>
                  <TableCell>
                    <div className="font-medium">{r.fullName}</div>
                    <div className="text-xs text-muted-foreground">{r.employeeCode}{r.designation ? ` · ${r.designation}` : ""}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">{r.department ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.present}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.late}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.early}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.missing}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.absent}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.leave}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{(r.workedMinutes / 60).toFixed(1)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.lateMinutes}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.lateAndMissing}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.lateDeductionDays}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${r.totalDeductionDays ? "text-destructive" : ""}`} title={`${r.absent} absent + ${r.lateDeductionDays} for lates`}>{r.totalDeductionDays}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
