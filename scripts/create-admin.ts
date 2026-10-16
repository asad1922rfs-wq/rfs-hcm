// Creates (or resets) a Super Admin account.
// Usage: ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='TempPass123' npm run user:create-admin
// The account must change its password at first sign-in.

import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordSchema } from "../src/server/auth/password";

const db = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "System Administrator";
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD.");
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(check.error.issues.map((i) => i.message).join(" "));

  const role = await db.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  if (!role) throw new Error("Run `npm run db:seed` first.");

  const passwordHash = await hashPassword(password);
  const user = await db.user.upsert({
    where: { email },
    create: { email, displayName: name, passwordHash, roleId: role.id, mustChangePassword: true },
    update: { passwordHash, roleId: role.id, isActive: true, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null },
  });
  await db.auditLog.create({ data: { action: "user.admin_bootstrap", entityType: "User", entityId: user.id, actorName: "cli" } });
  console.log(`Super Admin ready: ${email} (password change required at first sign-in)`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await db.$disconnect();
    process.exit(1);
  });
