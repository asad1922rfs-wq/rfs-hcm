import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";

// Company logo, stored on disk under STORAGE_DIR/branding (the Docker "storage" volume in production).

const STORAGE_DIR = process.env.STORAGE_DIR ?? join(process.cwd(), "storage");
const BRANDING_DIR = join(STORAGE_DIR, "branding");
const MAX_BYTES = 1024 * 1024;

const TYPES: Record<string, { ext: string; mime: string; check: (b: Buffer) => boolean }> = {
  png: { ext: "png", mime: "image/png", check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { ext: "jpg", mime: "image/jpeg", check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { ext: "webp", mime: "image/webp", check: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  svg: { ext: "svg", mime: "image/svg+xml", check: (b) => /<svg[\s>]/i.test(b.subarray(0, 2048).toString("utf8")) },
};

/** Reject SVGs that could run script when opened directly. */
function assertSafeSvg(text: string) {
  if (/<script|on[a-z]+\s*=|javascript:|<foreignObject|<iframe|<embed|<object/i.test(text)) {
    throw new AppError("This SVG contains scripts or embedded content. Export a plain SVG or use PNG.");
  }
}

export async function saveCompanyLogo(actor: Actor, file: File) {
  assertPermission(actor, "settings.company", "all");
  if (file.size === 0) throw new AppError("The file is empty.");
  if (file.size > MAX_BYTES) throw new AppError("The logo must be under 1 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const type = Object.values(TYPES).find((t) => t.check(buf));
  if (!type) throw new AppError("Upload a PNG, JPG, WEBP or SVG image.");
  if (type.ext === "svg") assertSafeSvg(buf.toString("utf8"));

  await mkdir(BRANDING_DIR, { recursive: true });
  const company = await db.company.findFirstOrThrow();
  const filename = `logo.${type.ext}`;
  if (company.logoPath && company.logoPath !== filename) await unlink(join(BRANDING_DIR, company.logoPath)).catch(() => undefined);
  await writeFile(join(BRANDING_DIR, filename), buf);
  // The version query in logoUrl() changes on every upload so browsers fetch the new image.
  await db.company.update({ where: { id: company.id }, data: { logoPath: filename } });
  await recordAudit({ actor, action: "company.logo", entityType: "Company", entityId: company.id, after: { file: filename, bytes: buf.length } });
}

export async function removeCompanyLogo(actor: Actor) {
  assertPermission(actor, "settings.company", "all");
  const company = await db.company.findFirstOrThrow();
  if (company.logoPath) await unlink(join(BRANDING_DIR, company.logoPath)).catch(() => undefined);
  await db.company.update({ where: { id: company.id }, data: { logoPath: null } });
  await recordAudit({ actor, action: "company.logo_removed", entityType: "Company", entityId: company.id });
}

export async function readCompanyLogo(): Promise<{ data: Buffer; mime: string } | null> {
  const company = await db.company.findFirst({ select: { logoPath: true } });
  if (!company?.logoPath) return null;
  const ext = company.logoPath.split(".").pop()!;
  const type = Object.values(TYPES).find((t) => t.ext === ext);
  if (!type) return null;
  try {
    return { data: await readFile(join(BRANDING_DIR, company.logoPath)), mime: type.mime };
  } catch {
    return null;
  }
}

/** Public URL of the logo (cache-busted by the company's last update), or null when none is set. */
export function logoUrl(company: { logoPath: string | null; updatedAt: Date }): string | null {
  return company.logoPath ? `/api/v1/company/logo?v=${company.updatedAt.getTime()}` : null;
}
