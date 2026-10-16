import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { resolveScope, type Permission, type Scope } from "./permissions";
import type { Actor } from "./session";

// Matches no employee — used when an account has no linked employee record.
const NOTHING: Prisma.EmployeeWhereInput = { id: { in: [] } };

/** The employee and every direct or indirect report beneath them. */
export async function teamEmployeeIds(managerEmployeeId: string): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE team AS (
      SELECT id FROM "Employee" WHERE id = ${managerEmployeeId}
      UNION
      SELECT e.id FROM "Employee" e JOIN team t ON e."managerId" = t.id
    )
    SELECT id FROM team`;
  return rows.map((r) => r.id);
}

export async function employeeWhereForScope(actor: Actor, scope: Scope): Promise<Prisma.EmployeeWhereInput> {
  switch (scope) {
    case "all":
      return {};
    case "department":
      if (actor.departmentId) return { departmentId: actor.departmentId };
      return actor.employeeId ? { id: actor.employeeId } : NOTHING;
    case "team":
      return actor.employeeId ? { id: { in: await teamEmployeeIds(actor.employeeId) } } : NOTHING;
    case "self":
      return actor.employeeId ? { id: actor.employeeId } : NOTHING;
  }
}

/**
 * Prisma filter restricting employees to those the actor may access under `permission`.
 * Every employee query in the service layer goes through this, so a forgotten filter cannot leak records.
 */
export async function scopedEmployeeWhere(actor: Actor, permission: Permission): Promise<Prisma.EmployeeWhereInput> {
  const scope = resolveScope(actor.grants, permission);
  if (!scope) throw new ForbiddenError();
  return employeeWhereForScope(actor, scope);
}

/** Throws unless the actor may access this specific employee under `permission`. */
export async function assertEmployeeAccess(actor: Actor, permission: Permission, employeeId: string): Promise<void> {
  const where = await scopedEmployeeWhere(actor, permission);
  const found = await db.employee.count({ where: { AND: [where, { id: employeeId }] } });
  if (found === 0) throw new ForbiddenError();
}

export async function canAccessEmployee(actor: Actor, permission: Permission, employeeId: string): Promise<boolean> {
  try {
    await assertEmployeeAccess(actor, permission, employeeId);
    return true;
  } catch {
    return false;
  }
}
