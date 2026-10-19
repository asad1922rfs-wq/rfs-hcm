import { describe, expect, it } from "vitest";
import { ineligibleLeaveMessage, leaveEligibility, type EmploymentType } from "@/core/leave/eligibility";

const annual = { permanentOnly: true };
const unpaid = { permanentOnly: false };
const NON_PERMANENT: EmploymentType[] = ["PROBATION", "CONTRACT", "INTERN", "PART_TIME"];

describe("leave eligibility", () => {
  it("permanent employees can take every leave type", () => {
    expect(leaveEligibility("PERMANENT", annual)).toEqual({ eligible: true, reason: null });
    expect(leaveEligibility("PERMANENT", unpaid)).toEqual({ eligible: true, reason: null });
  });

  it("non-permanent employees cannot take permanent-only types", () => {
    for (const t of NON_PERMANENT) {
      const r = leaveEligibility(t, annual);
      expect(r.eligible).toBe(false);
      expect(r.reason).toMatch(/^Not eligible \(/);
    }
    expect(leaveEligibility("PROBATION", annual).reason).toBe("Not eligible (probation)");
  });

  it("everyone can take types without the flag (e.g. unpaid leave)", () => {
    for (const t of NON_PERMANENT) expect(leaveEligibility(t, unpaid)).toEqual({ eligible: true, reason: null });
  });

  it("explains the refusal", () => {
    expect(ineligibleLeaveMessage("Annual Leave", "Abdul Rafay", "PROBATION")).toBe("Annual Leave is only for permanent employees (Abdul Rafay is on probation).");
    expect(ineligibleLeaveMessage("Sick Leave", "Sara", "INTERN")).toBe("Sick Leave is only for permanent employees (Sara is an intern).");
  });
});
