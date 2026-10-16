// Idempotent seed: company record, system roles and the default shift.
// Safe to re-run — it never overwrites values that an administrator has since changed.

import { PrismaClient } from "@prisma/client";
import { SYSTEM_ROLES } from "../src/server/auth/permissions";

const db = new PrismaClient();

async function main() {
  if ((await db.company.count()) === 0) {
    await db.company.create({
      data: {
        legalName: "Red Feather Solutions (RFS) (Private) Limited",
        shortName: "RFS",
        timezone: "Asia/Karachi",
        currency: "PKR",
        weekendDays: [0, 6], // Sunday, Saturday
      },
    });
    console.log("Created company record");
  }

  for (const [key, role] of Object.entries(SYSTEM_ROLES)) {
    const existing = await db.role.findUnique({ where: { key } });
    if (!existing) {
      await db.role.create({ data: { key, name: role.name, description: role.description, permissions: [...role.permissions], isSystem: true } });
      console.log(`Created role ${role.name}`);
    } else if (key === "SUPER_ADMIN") {
      // Super Admin must always keep full control.
      await db.role.update({ where: { key }, data: { permissions: ["*"] } });
    }
  }

  if ((await db.shift.count()) === 0) {
    await db.shift.create({
      data: { name: "General Shift", startMinute: 14 * 60, endMinute: 23 * 60, graceMinutes: 15, isDefault: true },
    });
    console.log("Created default shift 2:00 PM – 11:00 PM");
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
