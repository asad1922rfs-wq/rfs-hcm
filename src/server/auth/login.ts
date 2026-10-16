import "server-only";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { dummyVerify, verifyPassword } from "./password";
import { createSession } from "./session";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Per-IP throttle (in memory; one app instance). Account lockout below is the durable control.
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_ATTEMPTS = 30;
const ipAttempts = new Map<string, { count: number; resetAt: number }>();

function ipThrottled(ip: string | null): boolean {
  if (!ip) return false;
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    ipAttempts.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > IP_MAX_ATTEMPTS;
}

export type LoginOutcome = { ok: true; mustChangePassword: boolean } | { ok: false; error: string };

const GENERIC_ERROR = "Incorrect email/Employee ID or password.";

/** `identifier` is an email address or an Employee ID (case-insensitive). */
export async function attemptLogin(identifier: string, password: string, ip: string | null): Promise<LoginOutcome> {
  if (ipThrottled(ip)) return { ok: false, error: "Too many sign-in attempts. Please wait a few minutes and try again." };

  const id = identifier.trim();
  const user = await db.user.findFirst({
    where: {
      OR: [
        { email: { equals: id, mode: "insensitive" } },
        { employee: { employeeCode: { equals: id, mode: "insensitive" } } },
      ],
    },
    include: { employee: { select: { status: true } } },
  });

  if (!user) {
    await dummyVerify(password);
    return { ok: false, error: GENERIC_ERROR };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return { ok: false, error: "This account is temporarily locked after repeated failed sign-ins. Try again later." };
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_ATTEMPTS;
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MS) : undefined },
    });
    await recordAudit({ actor: null, action: lock ? "auth.locked" : "auth.failed", entityType: "User", entityId: user.id });
    return { ok: false, error: GENERIC_ERROR };
  }

  if (!user.isActive || (user.employee && user.employee.status !== "ACTIVE")) {
    return { ok: false, error: "This account is disabled. Please contact HR." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await createSession(user.id);
  await recordAudit({ actor: { userId: user.id, displayName: user.displayName }, action: "auth.login", entityType: "User", entityId: user.id });
  return { ok: true, mustChangePassword: user.mustChangePassword };
}
