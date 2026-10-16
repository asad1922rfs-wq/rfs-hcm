import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { requestMeta, type Actor } from "@/server/auth/session";

// Fields that must never be written into the audit trail in clear text.
const REDACTED_KEYS = new Set(["passwordHash", "password", "accountNumberEnc", "ibanEnc", "cnicEnc", "tokenHash"]);

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACTED_KEYS.has(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

type AuditInput = {
  actor: Pick<Actor, "userId" | "displayName"> | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

export async function recordAudit(input: AuditInput, tx: Prisma.TransactionClient = db): Promise<void> {
  const { ip, userAgent } = await requestMeta();
  await tx.auditLog.create({
    data: {
      actorUserId: input.actor?.userId ?? null,
      actorName: input.actor?.displayName ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before === undefined ? undefined : (redact(input.before) as Prisma.InputJsonValue),
      after: input.after === undefined ? undefined : (redact(input.after) as Prisma.InputJsonValue),
      ip,
      userAgent,
    },
  });
}
