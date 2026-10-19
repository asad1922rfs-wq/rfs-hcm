import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, type Actor } from "@/server/auth/session";
import { assertEmployeeAccess } from "@/server/auth/scope";
import {
  contentDisposition, documentStorageKey, documentTypeForMime, employeeDocumentsDir, resolveStoragePath, sanitizeFileName, sniffDocumentType,
} from "@/core/documents/files";
import { DOCUMENT_CATEGORIES, expiryStatus, MAX_DOCUMENT_BYTES, type DocumentCategory } from "@/core/documents/meta";
import { todayInPKT } from "@/lib/dates";

// Employee documents. Rows hold the metadata; the bytes live on disk under STORAGE_DIR/documents/<employeeId>/
// (the same storage folder as the company logo, kept outside the build so deploys don't wipe it).

const STORAGE_DIR = process.env.STORAGE_DIR ?? join(process.cwd(), "storage");

export type DocumentMeta = { category: DocumentCategory; title: string; expiresOn: Date | null };

/** An employee's documents, newest first, each flagged when expired or expiring within 30 days (Pakistan date). */
export async function listDocuments(actor: Actor, employeeId: string) {
  await assertEmployeeAccess(actor, "document.read", employeeId);
  const rows = await db.employeeDocument.findMany({
    where: { employeeId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, category: true, title: true, fileName: true, mimeType: true, sizeBytes: true, expiresOn: true, createdAt: true },
  });
  const today = todayInPKT();
  return rows.map((r) => ({ ...r, expiry: expiryStatus(r.expiresOn, today) }));
}

/** Writes to a temporary file in the same folder, then renames it into place, so a reader never sees half a file. */
async function writeAtomically(path: string, data: Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function uploadDocument(actor: Actor, employeeId: string, file: File, meta: DocumentMeta) {
  assertPermission(actor, "document.manage", "all");
  if (!DOCUMENT_CATEGORIES.includes(meta.category)) throw new AppError("Choose a category.");
  const title = meta.title.trim().slice(0, 200);
  if (!title) throw new AppError("Enter a title.");
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!employee) throw new NotFoundError("Employee not found.");

  if (file.size === 0) throw new AppError("The file is empty.");
  if (file.size > MAX_DOCUMENT_BYTES) throw new AppError("The file must be 10 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_DOCUMENT_BYTES) throw new AppError("The file must be 10 MB or smaller.");
  const type = sniffDocumentType(buf, file.name);
  if (!type) throw new AppError("Upload a PDF, JPG, PNG, WEBP or Word (DOC/DOCX) file.");

  // The id is chosen here (not by Prisma) because the file is written, under that id, before the row is created.
  const id = randomBytes(16).toString("hex");
  const storageKey = documentStorageKey(employeeId, id, type.ext);
  const fileName = sanitizeFileName(file.name, type.ext);
  const path = resolveStoragePath(STORAGE_DIR, storageKey);
  await writeAtomically(path, buf);

  try {
    const doc = await db.$transaction(async (tx) => {
      const created = await tx.employeeDocument.create({
        data: {
          id, employeeId, category: meta.category, title, fileName, mimeType: type.mime, sizeBytes: buf.length, storageKey,
          expiresOn: meta.expiresOn, uploadedById: actor.userId,
        },
      });
      await recordAudit(
        {
          actor, action: "document.upload", entityType: "EmployeeDocument", entityId: id,
          after: { employeeId, category: meta.category, title, fileName, mimeType: type.mime, sizeBytes: buf.length, expiresOn: meta.expiresOn },
        },
        tx,
      );
      return created;
    });
    return doc;
  } catch (err) {
    await unlink(path).catch(() => undefined);
    throw err;
  }
}

export async function deleteDocument(actor: Actor, documentId: string) {
  assertPermission(actor, "document.manage", "all");
  const doc = await db.employeeDocument.findUnique({ where: { id: documentId } });
  if (!doc) throw new NotFoundError("Document not found.");
  await db.$transaction(async (tx) => {
    await tx.employeeDocument.delete({ where: { id: doc.id } });
    await recordAudit(
      {
        actor, action: "document.delete", entityType: "EmployeeDocument", entityId: doc.id,
        before: { employeeId: doc.employeeId, category: doc.category, title: doc.title, fileName: doc.fileName, sizeBytes: doc.sizeBytes, expiresOn: doc.expiresOn },
      },
      tx,
    );
  });
  // After the row is gone: a failed unlink leaves an orphan file, never a row pointing at nothing.
  await unlink(resolveStoragePath(STORAGE_DIR, doc.storageKey)).catch(() => undefined);
  return { employeeId: doc.employeeId };
}

/** File contents and headers for a download. Reading someone else's document is recorded in the audit log. */
export async function readDocument(actor: Actor, documentId: string) {
  const doc = await db.employeeDocument.findUnique({ where: { id: documentId } });
  // Same answer for "missing" and "not yours", so ids cannot be probed.
  if (!doc) throw new NotFoundError("Document not found.");
  try {
    await assertEmployeeAccess(actor, "document.read", doc.employeeId);
  } catch {
    throw new NotFoundError("Document not found.");
  }
  const type = documentTypeForMime(doc.mimeType);
  if (!type) throw new NotFoundError("Document not found.");
  let data: Buffer;
  try {
    data = await readFile(resolveStoragePath(STORAGE_DIR, doc.storageKey));
  } catch {
    throw new NotFoundError("The file for this document is missing from storage.");
  }
  if (actor.employeeId !== doc.employeeId) {
    await recordAudit({ actor, action: "document.download", entityType: "EmployeeDocument", entityId: doc.id, after: { employeeId: doc.employeeId, fileName: doc.fileName } });
  }
  return { data, mime: type.mime, inline: type.inline, disposition: contentDisposition(doc.fileName, type.inline) };
}

/** Removes the document folders of deleted employees (their rows go with the employee by cascade). */
export async function removeEmployeeDocumentFiles(employeeIds: string[]) {
  for (const id of employeeIds) {
    try {
      await rm(resolveStoragePath(STORAGE_DIR, employeeDocumentsDir(id)), { recursive: true, force: true });
    } catch (err) {
      console.error(`Could not remove document files for employee ${id}`, err);
    }
  }
}
