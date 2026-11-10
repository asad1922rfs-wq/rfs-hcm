// RFS sales commission slab (same for every sales employee). The % applies to the whole month's sales in PKR.
export const DEFAULT_USD_RATE = 276;

export const COMMISSION_SLABS: readonly { upToUsd: number; percent: number }[] = [
  { upToUsd: 5000, percent: 0 },
  { upToUsd: 8000, percent: 3 },
  { upToUsd: 10500, percent: 5 },
  { upToUsd: 12500, percent: 7 },
  { upToUsd: Infinity, percent: 10 },
];

export function commissionPercent(achievedUsd: number): number {
  return COMMISSION_SLABS.find((s) => achievedUsd <= s.upToUsd)!.percent;
}

/** Commission in whole rupees: achieved $ × rate × slab %. */
export function commissionFor(achievedUsd: number, rate: number): number {
  if (!(achievedUsd > 0) || !(rate > 0)) return 0;
  return Math.round((achievedUsd * rate * commissionPercent(achievedUsd)) / 100);
}
