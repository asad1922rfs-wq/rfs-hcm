import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { monthRegister } from "@/server/services/attendance-edit";
import { employeePayHistory } from "@/server/services/payroll";
import { canAccessEmployee } from "@/server/auth/scope";
import { PayslipList } from "../../payslips/payslip-list";
import { RegisterTable } from "../../attendance/register-table";
import { can, requireActor } from "@/server/auth/session";
import { getEmployeeProfile } from "@/server/services/employees";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailList, EmptyState, humanize, StatusBadge } from "@/components/common";
import { formatDate, formatDateTime, formatMinuteOfDay, formatPKR } from "@/lib/format";
import { toDateOnlyString, todayInPKT } from "@/lib/dates";
import { initials } from "@/lib/utils";
import { BankDialog, RevealBank, SalaryRevisionDialog, StatusDialog } from "./panels";
import { DeleteEmployeesDialog } from "../delete-dialog";
import { PrivacyGroup, PrivacyToggle, PrivateAmount } from "@/components/private-amount";

export const metadata = { title: "Employee profile" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
function shiftMonth(ym: string, delta: number): string {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export default async function EmployeeProfilePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const sp = await searchParams;
  const currentMonth = toDateOnlyString(todayInPKT()).slice(0, 7);
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) && sp.month <= currentMonth ? sp.month : currentMonth;
  const payHistory = (await canAccessEmployee(actor, "salary.read", id))
    ? (await employeePayHistory(id)).map((h) => ({ id: h.id, label: h.label, netPay: Number(h.netPay), status: h.run.status, deductions: Number(h.deductions), earnings: Number(h.earnings) }))
    : null;
  const attendance = await monthRegister(actor, id, Number(month.slice(0, 4)), Number(month.slice(5, 7))).catch(() => null);
  const profile = await getEmployeeProfile(actor, id).catch((err) => {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  });
  const { employee: e, salary, bank } = profile;
  const canManage = can(actor, "employee.manage", "all");

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            <AvatarFallback className="bg-primary text-lg text-primary-foreground">{initials(e.fullName)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{e.fullName}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{e.employeeCode}</span>
              {e.designation && <><span aria-hidden>·</span><span>{e.designation.title}</span></>}
              {e.department && <><span aria-hidden>·</span><span>{e.department.name}</span></>}
              <StatusBadge status={e.status} />
            </p>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {can(actor, "employee.delete", "all") && actor.employeeId !== e.id && (
              <DeleteEmployeesDialog employees={[{ id: e.id, fullName: e.fullName, employeeCode: e.employeeCode }]} redirectTo="/employees" />
            )}
            <StatusDialog employeeId={e.id} status={e.status} />
            <Button asChild><Link href={`/employees/${e.id}/edit`}><Pencil /> Edit</Link></Button>
          </div>
        )}
      </div>

      <Tabs defaultValue={sp.tab === "attendance" || sp.tab === "payslips" ? sp.tab : "overview"}>
        <TabsList className="mb-4 w-full justify-start overflow-x-auto [&>button]:flex-none [&>button]:px-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {salary && <TabsTrigger value="salary">Salary</TabsTrigger>}
          {bank !== undefined && <TabsTrigger value="bank">Bank</TabsTrigger>}
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="payslips">Payslips</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Employment</CardTitle></CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: "Joining date", value: formatDate(e.joiningDate) },
                  { label: "Employment type", value: humanize(e.employmentType) },
                  { label: "Department", value: e.department?.name },
                  { label: "Designation", value: e.designation?.title },
                  {
                    label: "Reporting manager",
                    value: e.manager ? <Link className="hover:underline" href={`/employees/${e.manager.id}`}>{e.manager.fullName}</Link> : undefined,
                  },
                  { label: "Shift", value: e.shift ? `${e.shift.name} · ${formatMinuteOfDay(e.shift.startMinute)} – ${formatMinuteOfDay(e.shift.endMinute)}` : undefined },
                  { label: "Biometric user ID", value: e.deviceUserId },
                  ...(e.exitDate ? [{ label: "Exit date", value: formatDate(e.exitDate) }] : []),
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: "Email", value: e.email },
                  { label: "Phone", value: e.phone },
                  { label: "Date of birth", value: e.dateOfBirth ? formatDate(e.dateOfBirth) : undefined },
                  { label: "Gender", value: e.gender ? humanize(e.gender) : undefined },
                  { label: "CNIC", value: e.cnic },
                  { label: "Address", value: e.address },
                ]}
              />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Emergency contacts</CardTitle></CardHeader>
            <CardContent>
              {e.emergencyContacts.length ? (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {e.emergencyContacts.map((c) => (
                    <li key={c.id} className="rounded-md border p-3 text-sm">
                      <p className="font-medium">{c.name}</p>
                      <p className="text-muted-foreground">{c.relationship} · {c.phone}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Access</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {e.user ? (
                <DetailList
                  items={[
                    { label: "Role", value: e.user.role.name },
                    { label: "Login", value: e.user.isActive ? "Enabled" : "Disabled" },
                    { label: "Last sign-in", value: formatDateTime(e.user.lastLoginAt) },
                  ]}
                />
              ) : (
                <p className="text-muted-foreground">
                  No login yet.{" "}
                  {can(actor, "user.manage", "all") && <Link href="/settings/users" className="text-primary hover:underline">Create one</Link>}
                </p>
              )}
              {e.reports.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Direct reports</p>
                  <ul className="mt-1 grid gap-1">
                    {e.reports.map((r) => <li key={r.id}><Link href={`/employees/${r.id}`} className="hover:underline">{r.fullName}</Link></li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {salary && (
          <TabsContent value="salary" className="grid gap-6">
            <PrivacyGroup>
            <div className="flex justify-end"><PrivacyToggle /></div>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Current salary</CardTitle>
                  <CardDescription>
                    {salary.current ? `In force since ${formatDate(salary.current.effectiveFrom)}` : "No salary in force today."}
                  </CardDescription>
                </div>
                {can(actor, "salary.manage", "all") && <SalaryRevisionDialog employeeId={e.id} defaultDate={toDateOnlyString(todayInPKT())} />}
              </CardHeader>
              <CardContent>
                {salary.current ? (
                  <SalaryBreakdown basic={salary.current.basicSalary.toString()} allowances={salary.current.allowances.map((a) => ({ name: a.name, amount: a.amount.toString() }))} />
                ) : (
                  <EmptyState title="No salary set" description="Add a salary revision to set the monthly basic salary and allowances." />
                )}
              </CardContent>
            </Card>
            {salary.history.length > 0 && (
              <Card className="py-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Effective from</TableHead>
                      <TableHead className="text-right">Basic</TableHead>
                      <TableHead className="text-right">Allowances</TableHead>
                      <TableHead className="text-right">Monthly gross</TableHead>
                      <TableHead className="hidden sm:table-cell">Note</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salary.history.map((s) => {
                      const allowances = s.allowances.reduce((sum, a) => sum + Number(a.amount), 0);
                      return (
                        <TableRow key={s.id}>
                          <TableCell>{formatDate(s.effectiveFrom)}</TableCell>
                          <TableCell className="text-right tabular-nums"><PrivateAmount value={formatPKR(s.basicSalary)} /></TableCell>
                          <TableCell className="text-right tabular-nums"><PrivateAmount value={formatPKR(allowances)} /></TableCell>
                          <TableCell className="text-right font-medium tabular-nums"><PrivateAmount value={formatPKR(Number(s.basicSalary) + allowances)} /></TableCell>
                          <TableCell className="hidden text-muted-foreground sm:table-cell">{s.note ?? "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
            </PrivacyGroup>
          </TabsContent>
        )}

        {bank !== undefined && (
          <TabsContent value="bank">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Bank details</CardTitle>
                  <CardDescription>Restricted. Revealing full numbers is recorded in the audit log.</CardDescription>
                </div>
                {can(actor, "bank.manage", "all") && <BankDialog employeeId={e.id} current={bank} />}
              </CardHeader>
              <CardContent className="grid gap-4">
                {bank ? (
                  <>
                    <DetailList items={[{ label: "Bank", value: bank.bankName }, { label: "Branch", value: bank.branch }, { label: "Account title", value: bank.accountTitle }]} />
                    <RevealBank employeeId={e.id} masked={{ accountNumber: bank.accountNumber, iban: bank.iban }} />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No bank details on file.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="attendance" className="grid gap-3">
          {attendance ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="icon" aria-label="Previous month">
                  <Link href={`/employees/${e.id}?tab=attendance&month=${shiftMonth(month, -1)}`}><ChevronLeft /></Link>
                </Button>
                <span className="min-w-36 text-center font-medium">{monthLabel(month)}</span>
                {month < currentMonth && (
                  <Button asChild variant="outline" size="icon" aria-label="Next month">
                    <Link href={`/employees/${e.id}?tab=attendance&month=${shiftMonth(month, 1)}`}><ChevronRight /></Link>
                  </Button>
                )}
                {attendance.canEdit && <span className="text-xs text-muted-foreground">Use Edit to correct a day&apos;s check-in or check-out.</span>}
              </div>
              {attendance.rows.length ? (
                <RegisterTable rows={[...attendance.rows].reverse()} canEdit={attendance.canEdit} mode="monthly" />
              ) : (
                <EmptyState title="No attendance days in this month" />
              )}
            </>
          ) : (
            <EmptyState title="Attendance" description="You do not have access to this employee's attendance." />
          )}
        </TabsContent>
        <TabsContent value="leave">
          <EmptyState title="Leave balances" description="Leave management arrives in Phase 4." />
        </TabsContent>
        <TabsContent value="payslips">
          {payHistory ? <PayslipList rows={payHistory} /> : <EmptyState title="Payslips" description="You do not have access to this employee's pay." />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function SalaryBreakdown({ basic, allowances }: { basic: string; allowances: { name: string; amount: string }[] }) {
  const total = Number(basic) + allowances.reduce((s, a) => s + Number(a.amount), 0);
  return (
    <dl className="grid max-w-md gap-2 text-sm">
      <div className="flex justify-between"><dt>Basic salary</dt><dd className="tabular-nums"><PrivateAmount value={formatPKR(basic)} /></dd></div>
      {allowances.map((a, i) => (
        <div key={i} className="flex justify-between text-muted-foreground"><dt>{a.name}</dt><dd className="tabular-nums"><PrivateAmount value={formatPKR(a.amount)} /></dd></div>
      ))}
      <div className="mt-1 flex justify-between border-t pt-2 font-semibold"><dt>Monthly gross</dt><dd className="tabular-nums"><PrivateAmount value={formatPKR(total)} /></dd></div>
    </dl>
  );
}
