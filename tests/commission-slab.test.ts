import { describe, expect, it } from "vitest";
import { commissionFor, commissionPercent } from "@/core/sales/commission";

describe("sales commission slab", () => {
  it("picks the slab by achieved dollars", () => {
    expect(commissionPercent(5000)).toBe(0);
    expect(commissionPercent(5000.01)).toBe(3);
    expect(commissionPercent(8000)).toBe(3);
    expect(commissionPercent(10500)).toBe(5);
    expect(commissionPercent(12500)).toBe(7);
    expect(commissionPercent(12501)).toBe(10);
  });
  it("pays the % on the whole PKR sales", () => {
    expect(commissionFor(9000, 276)).toBe(124200);
    expect(commissionFor(8702.52, 276)).toBe(120095);
    expect(commissionFor(4000, 276)).toBe(0);
    expect(commissionFor(9000, 0)).toBe(0);
  });
});
