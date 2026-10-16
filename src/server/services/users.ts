import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/server/errors";
import { assertPermission, revokeUserSessions, type Actor } from "@/server/auth/session";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { isValidGrant, SYSTEM_ROLES } from "@/server/auth/permissions";
import { asStringArray } from "@/server/json-fields";

const isSuperAdmin = (actor: Actor) => actor.roleKey === "SUPER_ADMIN";

/** Only a Super Admin may create, change or reset another Super Admin. */
async function assertCanAssignRole(actor: Actor, roleId: string) {
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new NotFoundError("Role not found.");
  if ((role.key === "SUPER_ADMIN" || asStringArray(role.permissions).includes("*")) && !isSuperAdmin(actor)) {
    throw new ForbiddenError("Only a Super Admin can assign the Super Admin role.");
  }
  return role;
}

async function assertCanManageUser(actor: Actor, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user) throw new NotFoundError("User not found.");
  if (user.role.key === "SUPER_ADMIN" && !isSuperAdmin(actor)) throw new ForbiddenError("Only a Super Admin can manage Super Admin accounts.");
  return user;
}

export function listUsers() {
  return db.user.findMany({
    orderBy: { displayName: "asc" },
    select: {
      id: true, email: true, displayName: true, isActive: true, lastLoginAt: true, lockedUntil: true, mustChangePassword: true,
      role: { select: { id: true, name: true, key: true } },
      employee: { select: { id: true, employeeCode: true, status: true } },
    },
  });
}

export function listRoles() {
  return db.role.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { users: true } } } });
}

/** Employees that do not yet have a login. */
export function employeesWithoutAccount() {
  return db.employee.findMany({
    where: { user: null, status: "ACTIVE" },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, employeeCode: true, email: true },
  });
}

export async function createUser(actor: Actor, input: { employeeId?: string; email?: string; displayName?: string; roleId: string; temporaryPassword: string }) {
  assertPermission(actor, "user.manage", "all");
  const role = await assertCanAssignRole(actor, input.roleId);

  let displayName = input.displayName;
  let email = input.email ?? null;
  if (input.employeeId) {
    const employee = await db.employee.findUnique({ where: { id: input.employeeId }, include: { user: true } });
    if (!employee) throw new NotFoundError("Employee not found.");
    if (employee.user) throw new AppError("This employee already has a login.");
    displayName = employee.fullName;
    email ??= employee.email;
  }
  if (!displayName) throw new AppError("Name is required for accounts not linked to an employee.");
  if (!input.employeeId && !email) throw new AppError("Email is required for accounts not linked to an employee.");

  try {
    const user = await db.user.create({
      data: {
        email: email?.toLowerCase() ?? null,
        displayName,
        roleId: role.id,
        employeeId: input.employeeId ?? null,
        passwordHash: await hashPassword(input.temporaryPassword),
        mustChangePassword: true,
      },
    });
    await recordAudit({ actor, action: "user.create", entityType: "User", entityId: user.id, after: { ...user, role: role.key } });
    return user;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new AppError("That email is already used by another login.");
    throw err;
  }
}

/** 10-character temporary password with letters and digits (no look-alike characters). */
function temporaryPassword(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => all[b % all.length]!);
  chars[0] = letters[bytes[0]! % letters.length]!;
  chars[9] = digits[bytes[9]! % digits.length]!;
  return chars.join("");
}

export type BulkLogin = { employeeCode: string; fullName: string; login: string; email: string | null; role: string; temporaryPassword: string };

/**
 * Creates logins for every active employee who has none. Employees with direct reports get the Manager role,
 * everyone else Employee. Temporary passwords are returned once (for HR to hand out) and stored only as hashes.
 */
export async function createLoginsInBulk(actor: Actor): Promise<BulkLogin[]> {
  assertPermission(actor, "user.manage", "all");
  const [roles, employees, takenEmails] = await Promise.all([
    db.role.findMany({ where: { key: { in: ["EMPLOYEE", "MANAGER"] } } }),
    db.employee.findMany({
      where: { status: "ACTIVE", user: null },
      orderBy: { fullName: "asc" },
      select: { id: true, employeeCode: true, fullName: true, email: true, _count: { select: { reports: { where: { status: "ACTIVE" } } } } },
    }),
    db.user.findMany({ where: { email: { not: null } }, select: { email: true } }),
  ]);
  const roleId = (key: string) => roles.find((r) => r.key === key)?.id;
  if (!roleId("EMPLOYEE") || !roleId("MANAGER")) throw new AppError("Built-in roles are missing — run the database seed.");
  const emails = new Set(takenEmails.map((u) => u.email!.toLowerCase()));

  const created: BulkLogin[] = [];
  for (const e of employees) {
    const isManager = e._count.reports > 0;
    const email = e.email && !emails.has(e.email.toLowerCase()) ? e.email.toLowerCase() : null;
    if (email) emails.add(email);
    const password = temporaryPassword();
    await db.user.create({
      data: {
        email,
        displayName: e.fullName,
        roleId: roleId(isManager ? "MANAGER" : "EMPLOYEE")!,
        employeeId: e.id,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });
    created.push({ employeeCode: e.employeeCode, fullName: e.fullName, login: e.employeeCode, email, role: isManager ? "Manager" : "Employee", temporaryPassword: password });
  }
  await recordAudit({ actor, action: "user.bulk_create", entityType: "User", after: { count: created.length, codes: created.map((c) => c.employeeCode) } });
  return created;
}

export async function updateUser(actor: Actor, userId: string, input: { roleId: string; isActive: boolean }) {
  assertPermission(actor, "user.manage", "all");
  const before = await assertCanManageUser(actor, userId);
  const role = await assertCanAssignRole(actor, input.roleId);
  if (userId === actor.userId && (!input.isActive || role.id !== before.roleId)) {
    throw new AppError("You cannot disable your own account or change your own role.");
  }
  if (before.role.key === "SUPER_ADMIN" && (role.key !== "SUPER_ADMIN" || !input.isActive)) {
    const remaining = await db.user.count({ where: { role: { key: "SUPER_ADMIN" }, isActive: true, NOT: { id: userId } } });
    if (remaining === 0) throw new AppError("At least one active Super Admin must remain.");
  }

  const after = await db.user.update({ where: { id: userId }, data: { roleId: role.id, isActive: input.isActive } });
  if (!input.isActive || role.id !== before.roleId) await revokeUserSessions(userId);
  await recordAudit({ actor, action: "user.update", entityType: "User", entityId: userId, before: { role: before.role.key, isActive: before.isActive }, after: { role: role.key, isActive: after.isActive } });
}

export async function resetUserPassword(actor: Actor, userId: string, temporaryPassword: string) {
  assertPermission(actor, "user.manage", "all");
  await assertCanManageUser(actor, userId);
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
  });
  await revokeUserSessions(userId);
  await recordAudit({ actor, action: "user.password_reset", entityType: "User", entityId: userId });
}

export async function changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) throw new AppError("Current password is incorrect.");
  if (await verifyPassword(user.passwordHash, newPassword)) throw new AppError("Choose a password different from the current one.");
  await db.user.update({
    where: { id: actor.userId },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
  });
  // Sign out every other device.
  await revokeUserSessions(actor.userId, actor.sessionId);
  await recordAudit({ actor, action: "user.password_change", entityType: "User", entityId: actor.userId });
}

export async function updateRolePermissions(actor: Actor, roleId: string, grants: string[]) {
  assertPermission(actor, "role.manage", "all");
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new NotFoundError("Role not found.");
  if (role.key === "SUPER_ADMIN") throw new AppError("The Super Admin role always has full access and cannot be edited.");
  const clean = [...new Set(grants)].filter((g) => g !== "*");
  const invalid = clean.filter((g) => !isValidGrant(g));
  if (invalid.length) throw new AppError(`Invalid permissions: ${invalid.join(", ")}`);

  await db.role.update({ where: { id: roleId }, data: { permissions: clean } });
  // Sessions read permissions live from the role, so changes apply on the next request.
  await recordAudit({ actor, action: "role.update", entityType: "Role", entityId: roleId, before: role.permissions, after: clean });
}

export async function resetRoleToDefault(actor: Actor, roleId: string) {
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw new NotFoundError("Role not found.");
  const defaults = SYSTEM_ROLES[role.key as keyof typeof SYSTEM_ROLES];
  if (!defaults) throw new AppError("Only built-in roles have defaults.");
  await updateRolePermissions(actor, roleId, [...defaults.permissions]);
}
