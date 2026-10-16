import type { Prisma } from "@prisma/client";

// MySQL has no array columns, so list-like fields (Company.weekendDays, Role.permissions, PayrollItem.warnings)
// are stored as JSON. These readers turn them back into typed arrays, ignoring anything malformed.

export function asNumberArray(value: Prisma.JsonValue | null | undefined, fallback: number[] = []): number[] {
  return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : fallback;
}

export function asStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Company weekly off days (0 = Sunday … 6 = Saturday); Saturday + Sunday when unset. */
export const weekendOf = (company: { weekendDays: Prisma.JsonValue } | null | undefined) => asNumberArray(company?.weekendDays, [0, 6]);
