import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { randomToken, sha256 } from "@/server/crypto";
import { ForbiddenError } from "@/server/errors";
import { hasScope, resolveScope, type Permission, type Scope } from "./permissions";
import { asStringArray } from "@/server/json-fields";

export const SESSION_COOKIE = "rfs_session";
/** Absolute session lifetime. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Sessions unused for this long are rejected. */
const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** Avoid a DB write on every request: only touch lastSeenAt when it is older than this. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type Actor = {
  userId: string;
  sessionId: string;
  displayName: string;
  email: string | null;
  roleKey: string;
  roleName: string;
  grants: string[];
  employeeId: string | null;
  departmentId: string | null;
  mustChangePassword: boolean;
};

export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  const { ip, userAgent } = await requestMeta();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { tokenHash: sha256(token), userId, expiresAt, ip, userAgent } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) } });
}

/** The signed-in user for this request, or null. Cached per request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { role: true, employee: { select: { id: true, departmentId: true, status: true } } } } },
  });
  if (!session) return null;

  const now = Date.now();
  const { user } = session;
  const expired = session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS;
  const employeeBlocked = user.employee && user.employee.status !== "ACTIVE";
  if (expired || !user.isActive || employeeBlocked) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }

  return {
    userId: user.id,
    sessionId: session.id,
    displayName: user.displayName,
    email: user.email,
    roleKey: user.role.key,
    roleName: user.role.name,
    grants: asStringArray(user.role.permissions),
    employeeId: user.employee?.id ?? null,
    departmentId: user.employee?.departmentId ?? null,
    mustChangePassword: user.mustChangePassword,
  };
});

/** For pages: redirect to /login when signed out, and to /change-password when a password change is pending. */
export async function requireActor(opts: { allowPendingPasswordChange?: boolean } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword && !opts.allowPendingPasswordChange) redirect("/change-password");
  return actor;
}

/** For pages: show the not-authorised screen unless the actor has the permission. */
export async function requirePagePermission(permission: Permission, atLeast: Scope = "self"): Promise<Actor> {
  const actor = await requireActor();
  if (!hasScope(actor.grants, permission, atLeast)) redirect("/forbidden");
  return actor;
}

/** For server actions and API handlers: throw unless the actor has the permission. Returns the granted scope. */
export function assertPermission(actor: Actor, permission: Permission, atLeast: Scope = "self"): Scope {
  const scope = resolveScope(actor.grants, permission);
  if (!scope || !hasScope(actor.grants, permission, atLeast)) throw new ForbiddenError();
  return scope;
}

export function can(actor: Actor, permission: Permission, atLeast: Scope = "self"): boolean {
  return hasScope(actor.grants, permission, atLeast);
}
