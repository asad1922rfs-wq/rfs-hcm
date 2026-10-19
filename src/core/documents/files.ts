// Employee documents: file-type sniffing, name sanitising and storage paths. Pure functions (server side: uses node:path).

import { isAbsolute, relative, resolve, sep } from "node:path";

export type SniffedType = { ext: string; mime: string; inline: boolean };

const PDF: SniffedType = { ext: ".pdf", mime: "application/pdf", inline: true };
const JPG: SniffedType = { ext: ".jpg", mime: "image/jpeg", inline: true };
const PNG: SniffedType = { ext: ".png", mime: "image/png", inline: true };
const WEBP: SniffedType = { ext: ".webp", mime: "image/webp", inline: true };
const DOC: SniffedType = { ext: ".doc", mime: "application/msword", inline: false };
const DOCX: SniffedType = { ext: ".docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false };

const ALL_TYPES = [PDF, JPG, PNG, WEBP, DOC, DOCX];

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => b.length >= at + bytes.length && bytes.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

/** Searches raw bytes for an ASCII string (zip entry names are stored uncompressed in the headers). */
function containsAscii(b: Uint8Array, needle: string): boolean {
  const n = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + n.length <= b.length; i++) {
    for (let j = 0; j < n.length; j++) if (b[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * Works out what a file really is from its first bytes; the browser's MIME type and the file name are not trusted.
 * Returns null for anything that is not an allowed type. DOC (OLE2) is accepted only when the name also ends in .doc,
 * since the same container is used by old Excel and PowerPoint files.
 */
export function sniffDocumentType(bytes: Uint8Array, fileName: string): SniffedType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return PDF; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPG;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return WEBP;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // Office Open XML: a zip with [Content_Types].xml and a word/ part.
    return containsAscii(bytes, "[Content_Types].xml") && containsAscii(bytes, "word/") ? DOCX : null;
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return /\.doc$/i.test(fileName.trim()) ? DOC : null;
  }
  return null;
}

/** The type stored for a document, looked up from its MIME type (for serving files already on disk). */
export function documentTypeForMime(mime: string): SniffedType | null {
  return ALL_TYPES.find((t) => t.mime === mime) ?? null;
}

/**
 * Original file name made safe to store and show: no directories, control characters, or characters Windows rejects;
 * collapsed whitespace; at most 255 characters with the extension kept. The sniffed extension replaces a wrong one.
 */
export function sanitizeFileName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    // Control characters, characters Windows rejects, and bidi overrides (used to disguise an extension).
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  const extLower = ext.toLowerCase();
  const sameFamily = (extLower === ".jpg" && /\.jpe?g$/i.test(base)) || base.toLowerCase().endsWith(extLower);
  const finalExt = sameFamily ? base.slice(base.lastIndexOf(".")).toLowerCase() : extLower;
  // Only a matching extension is removed from the stem; "Report.v2" stays "Report.v2.pdf".
  const rawStem = sameFamily ? base.slice(0, base.lastIndexOf(".")) : base;
  const stem = Array.from(rawStem).slice(0, 255 - finalExt.length).join("").trim() || "document";
  return `${stem}${finalExt}`;
}

const ID_RE = /^[a-z0-9]{1,40}$/i;

/** Storage key (relative to STORAGE_DIR) for a document: documents/<employeeId>/<docId><ext>. */
export function documentStorageKey(employeeId: string, docId: string, ext: string): string {
  if (!ID_RE.test(employeeId) || !ID_RE.test(docId)) throw new Error("Invalid document id");
  if (!ALL_TYPES.some((t) => t.ext === ext)) throw new Error("Invalid document extension");
  return `documents/${employeeId}/${docId}${ext}`;
}

/** Folder holding an employee's documents, relative to STORAGE_DIR. */
export function employeeDocumentsDir(employeeId: string): string {
  if (!ID_RE.test(employeeId)) throw new Error("Invalid employee id");
  return `documents/${employeeId}`;
}

/** Absolute path for a storage key. Throws if the key would point outside the storage root. */
export function resolveStoragePath(storageRoot: string, key: string): string {
  // Keys always use forward slashes; a backslash is a separator on Windows but an ordinary character on Linux.
  if (!key || key.includes("\0") || key.includes("\\") || isAbsolute(key) || /^[a-z]:/i.test(key)) throw new Error("Invalid storage key");
  const root = resolve(storageRoot);
  const full = resolve(root, key);
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) throw new Error("Invalid storage key");
  return full;
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266 / RFC 5987). */
export function contentDisposition(fileName: string, inline: boolean): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").replace(/[%;]/g, "_") || "document";
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
