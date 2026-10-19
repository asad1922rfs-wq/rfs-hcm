import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  contentDisposition, documentStorageKey, documentTypeForMime, employeeDocumentsDir, resolveStoragePath, sanitizeFileName, sniffDocumentType,
} from "@/core/documents/files";
import { expiryStatus, formatBytes } from "@/core/documents/meta";
import { hasScope, resolveScope, SYSTEM_ROLES } from "@/server/auth/permissions";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("sniffDocumentType", () => {
  it("recognises PDF, JPG, PNG and WEBP from their bytes, whatever the name says", () => {
    expect(sniffDocumentType(bytes("%PDF-1.7\n"), "scan.png")?.mime).toBe("application/pdf");
    expect(sniffDocumentType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), "photo")?.ext).toBe(".jpg");
    expect(sniffDocumentType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "x.pdf")?.mime).toBe("image/png");
    expect(sniffDocumentType(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 "), "x.webp")?.mime).toBe("image/webp");
  });

  it("accepts a DOCX zip but not an arbitrary zip", () => {
    const docx = bytes([0x50, 0x4b, 0x03, 0x04], "\0\0\0\0[Content_Types].xml....word/document.xml");
    expect(sniffDocumentType(docx, "cv.docx")?.ext).toBe(".docx");
    const zip = bytes([0x50, 0x4b, 0x03, 0x04], "\0\0\0\0payload/evil.js");
    expect(sniffDocumentType(zip, "cv.docx")).toBeNull();
    const xlsx = bytes([0x50, 0x4b, 0x03, 0x04], "\0\0[Content_Types].xml..xl/workbook.xml");
    expect(sniffDocumentType(xlsx, "sheet.docx")).toBeNull();
  });

  it("accepts an OLE2 file only when it is named .doc", () => {
    const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(sniffDocumentType(ole, "Letter.DOC")?.mime).toBe("application/msword");
    expect(sniffDocumentType(ole, "book.xls")).toBeNull();
  });

  it("rejects HTML, SVG, executables and empty files even with an allowed name", () => {
    expect(sniffDocumentType(bytes("<html><script>alert(1)</script>"), "cnic.pdf")).toBeNull();
    expect(sniffDocumentType(bytes("<svg xmlns='http://www.w3.org/2000/svg'>"), "cnic.png")).toBeNull();
    expect(sniffDocumentType(bytes("MZ", [0x90, 0]), "cnic.jpg")).toBeNull();
    expect(sniffDocumentType(new Uint8Array(), "cnic.pdf")).toBeNull();
    expect(sniffDocumentType(bytes(" %PDF-1.4"), "cnic.pdf")).toBeNull();
  });

  it("maps a stored MIME type back to its type", () => {
    expect(documentTypeForMime("image/jpeg")?.inline).toBe(true);
    expect(documentTypeForMime("application/msword")?.inline).toBe(false);
    expect(documentTypeForMime("text/html")).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("drops directories and unsafe characters", () => {
    expect(sanitizeFileName("C:\\Users\\me\\..\\CNIC copy.pdf", ".pdf")).toBe("CNIC copy.pdf");
    expect(sanitizeFileName("../../etc/passwd", ".pdf")).toBe("passwd.pdf");
    expect(sanitizeFileName('a<b>:"c|?*\u0007.png', ".png")).toBe("abc.png");
    expect(sanitizeFileName("   ...hidden.pdf", ".pdf")).toBe("hidden.pdf");
  });

  it("strips bidi overrides used to disguise extensions", () => {
    expect(sanitizeFileName("invoice\u202Efdp.exe", ".pdf")).toBe("invoicefdp.exe.pdf");
  });

  it("uses the detected extension and keeps an equivalent one", () => {
    expect(sanitizeFileName("scan", ".pdf")).toBe("scan.pdf");
    expect(sanitizeFileName("scan.png", ".pdf")).toBe("scan.png.pdf");
    expect(sanitizeFileName("Photo.JPEG", ".jpg")).toBe("Photo.jpeg");
    expect(sanitizeFileName("Report.v2", ".docx")).toBe("Report.v2.docx");
    expect(sanitizeFileName("", ".pdf")).toBe("document.pdf");
  });

  it("limits the name to 255 characters and keeps the extension", () => {
    const out = sanitizeFileName(`${"a".repeat(400)}.pdf`, ".pdf");
    expect(out).toHaveLength(255);
    expect(out.endsWith(".pdf")).toBe(true);
    expect(sanitizeFileName(`${"ب".repeat(300)}.pdf`, ".pdf")).toHaveLength(255);
  });
});

describe("storage paths", () => {
  const root = resolve("/srv/storage");

  it("builds keys under documents/<employee>/", () => {
    expect(documentStorageKey("clx123abc", "a1b2c3", ".pdf")).toBe("documents/clx123abc/a1b2c3.pdf");
    expect(employeeDocumentsDir("clx123abc")).toBe("documents/clx123abc");
    expect(resolveStoragePath(root, "documents/clx123abc/a1b2c3.pdf")).toBe(join(root, "documents", "clx123abc", "a1b2c3.pdf"));
  });

  it("refuses ids or extensions that could change the path", () => {
    expect(() => documentStorageKey("../x", "a", ".pdf")).toThrow();
    expect(() => documentStorageKey("emp", "a/b", ".pdf")).toThrow();
    expect(() => documentStorageKey("emp", "a", ".html")).toThrow();
    expect(() => documentStorageKey("emp", "a", "/../../x")).toThrow();
    expect(() => employeeDocumentsDir("..")).toThrow();
    expect(() => employeeDocumentsDir("")).toThrow();
  });

  it("never resolves outside the storage root", () => {
    for (const key of ["../secret", "documents/../../etc/passwd", "/etc/passwd", "C:\\Windows\\win.ini", "", ".", "documents/\0x", "..\\..\\x"]) {
      expect(() => resolveStoragePath(root, key), key).toThrow();
    }
  });
});

describe("contentDisposition", () => {
  it("gives an ASCII fallback and an RFC 5987 UTF-8 name", () => {
    expect(contentDisposition("CNIC.pdf", true)).toBe(`inline; filename="CNIC.pdf"; filename*=UTF-8''CNIC.pdf`);
    const h = contentDisposition('شناختی "کارڈ".pdf', false);
    expect(h.startsWith('attachment; filename="')).toBe(true);
    expect(h).not.toMatch(/filename="[^"]*[^\x20-\x7e][^"]*"/);
    expect(h).toContain("filename*=UTF-8''%D8%B4");
    expect(contentDisposition("a'b(c).pdf", true)).toContain("filename*=UTF-8''a%27b%28c%29.pdf");
  });
});

describe("expiryStatus", () => {
  const today = new Date(Date.UTC(2026, 9, 19));
  it("flags expired and expiring-within-30-days documents", () => {
    expect(expiryStatus(null, today)).toBeNull();
    expect(expiryStatus(new Date(Date.UTC(2026, 9, 18)), today)).toBe("expired");
    expect(expiryStatus(new Date(Date.UTC(2026, 9, 19)), today)).toBe("soon");
    expect(expiryStatus(new Date(Date.UTC(2026, 10, 18)), today)).toBe("soon");
    expect(expiryStatus(new Date(Date.UTC(2026, 10, 19)), today)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});

describe("document permissions", () => {
  it("keep documents private: only HR (and Super Admin) see others' documents", () => {
    expect(resolveScope(SYSTEM_ROLES.EMPLOYEE.permissions, "document.read")).toBe("self");
    expect(resolveScope(SYSTEM_ROLES.MANAGER.permissions, "document.read")).toBe("self");
    expect(resolveScope(SYSTEM_ROLES.FINANCE.permissions, "document.read")).toBe("self");
    expect(resolveScope(SYSTEM_ROLES.HR_ADMIN.permissions, "document.read")).toBe("all");
    expect(hasScope(SYSTEM_ROLES.HR_ADMIN.permissions, "document.manage", "all")).toBe(true);
    for (const key of ["EMPLOYEE", "MANAGER", "FINANCE"] as const) {
      expect(resolveScope(SYSTEM_ROLES[key].permissions, "document.manage")).toBeNull();
    }
  });
});
