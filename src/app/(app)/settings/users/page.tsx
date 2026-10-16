import Link from "next/link";
import { requirePagePermission } from "@/server/auth/session";
import { employeesWithoutAccount, listRoles, listUsers } from "@/server/services/users";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/common";
import { formatDateTime } from "@/lib/format";
import { CreateUserDialog, EditUserDialog, ResetPasswordDialog } from "./users-client";
import { BulkLoginsDialog } from "./bulk-logins";
import { env } from "@/lib/env";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requirePagePermission("user.manage", "all");
  const [users, roles, employees] = await Promise.all([listUsers(), listRoles(), employeesWithoutAccount()]);
  // Only a Super Admin may hand out (or manage) Super Admin access.
  const isSuperAdmin = actor.roleKey === "SUPER_ADMIN";
  const assignable = roles.filter((r) => isSuperAdmin || (r.key !== "SUPER_ADMIN" && !r.permissions.includes("*")));
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Users"
        description={`${users.length} login${users.length === 1 ? "" : "s"} · ${employees.length} active employee${employees.length === 1 ? "" : "s"} without a login`}
        actions={
          <>
            <BulkLoginsDialog count={employees.length} appUrl={env.APP_URL} />
            <CreateUserDialog employees={employees} roles={assignable} />
          </>
        }
      />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden md:table-cell">Last sign-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const locked = u.lockedUntil && u.lockedUntil.getTime() > now;
              const manageable = isSuperAdmin || u.role.key !== "SUPER_ADMIN";
              return (
                <TableRow key={u.id}>
                  <TableCell>
                    <span className="block font-medium">
                      {u.employee ? <Link href={`/employees/${u.employee.id}`} className="hover:underline">{u.displayName}</Link> : u.displayName}
                    </span>
                    <span className="block text-xs text-muted-foreground">{[u.email, u.employee?.employeeCode].filter(Boolean).join(" · ")}</span>
                  </TableCell>
                  <TableCell>{u.role.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{formatDateTime(u.lastLoginAt)}</TableCell>
                  <TableCell className="space-x-1">
                    {u.isActive ? <Badge variant="secondary">Enabled</Badge> : <Badge variant="outline">Disabled</Badge>}
                    {locked && <Badge variant="destructive">Locked</Badge>}
                    {u.mustChangePassword && <Badge variant="outline">Temp password</Badge>}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {manageable && u.id !== actor.userId && (
                      <>
                        <EditUserDialog user={{ id: u.id, displayName: u.displayName, isActive: u.isActive, roleId: u.role.id }} roles={assignable} />
                        <ResetPasswordDialog user={{ id: u.id, displayName: u.displayName }} />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
