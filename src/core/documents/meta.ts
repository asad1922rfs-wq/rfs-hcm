// Employee document categories, limits and display helpers. Safe on client and server.

export const DOCUMENT_CATEGORIES = ["CNIC", "CV", "OFFER_LETTER", "CONTRACT", "EDUCATION", "EXPERIENCE", "MEDICAL", "OTHER"] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  CNIC: "CNIC",
  CV: "CV / resume",
  OFFER_LETTER: "Offer letter",
  CONTRACT: "Contract",
  EDUCATION: "Education certificate",
  EXPERIENCE: "Experience letter",
  MEDICAL: "Medical",
  OTHER: "Other",
};

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** Value for <input type="file" accept>. The server checks the actual bytes; this only filters the picker. */
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp";

/** "expired" once the expiry date has passed, "soon" within `withinDays` days, otherwise null. Dates are UTC-midnight calendar dates. */
export function expiryStatus(expiresOn: Date | null, today: Date, withinDays = 30): "expired" | "soon" | null {
  if (!expiresOn) return null;
  const days = Math.round((expiresOn.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= withinDays) return "soon";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
