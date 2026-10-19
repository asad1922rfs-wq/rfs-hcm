import { describe, expect, it } from "vitest";
import { hasScope, isValidGrant, PERMISSIONS, resolveScope, SYSTEM_ROLES } from "@/server/auth/permissions";

describe("resolveScope", () => {
  it("returns null when a permission is not granted", () => {
    expect(resolveScope(["employee.read:self"], "salary.read")).toBeNull();
  });

  it("returns the highest of several grants", () => {
    expect(resolveScope(["employee.read:self", "employee.read:department", "employee.read:team"], "employee.read")).toBe("department");
  });

  it("treats * as all", () => {
    expect(resolveScope(["*"], "payroll.approve")).toBe("all");
  });

  it("ignores malformed grants", () => {
    expect(resolveScope(["employee.read:everyone", "employee.read"], "employee.read")).toBeNull();
  });
});

describe("hasScope", () => {
  it("self does not satisfy a team requirement", () => {
    expect(hasScope(["employee.read:self"], "employee.read", "team")).toBe(false);
    expect(hasScope(["employee.read:team"], "employee.read", "team")).toBe(true);
    expect(hasScope(["employee.read:all"], "employee.read", "team")).toBe(true);
  });
});

describe("isValidGrant", () => {
  it("accepts only scopes the permission supports", () => {
    expect(isValidGrant("employee.manage:all")).toBe(true);
    expect(isValidGrant("employee.manage:self")).toBe(false);
    expect(isValidGrant("unknown.perm:all")).toBe(false);
  });
});

describe("system roles", () => {
  it("contain only valid grants", () => {
    for (const role of Object.values(SYSTEM_ROLES)) {
      for (const grant of role.permissions) expect(isValidGrant(grant), grant).toBe(true);
    }
  });

  it("employees can only reach their own records", () => {
    const grants = SYSTEM_ROLES.EMPLOYEE.permissions;
    for (const perm of Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]) {
      const scope = resolveScope(grants, perm);
      expect(scope === null || scope === "self", `${perm} → ${scope}`).toBe(true);
    }
  });

  it("managers cannot see salaries or bank details of others by default", () => {
    expect(resolveScope(SYSTEM_ROLES.MANAGER.permissions, "salary.read")).toBe("self");
    expect(resolveScope(SYSTEM_ROLES.MANAGER.permissions, "bank.read")).toBe("self");
  });

  it("Finance approves and pays payroll but cannot prepare it", () => {
    expect(hasScope(SYSTEM_ROLES.FINANCE.permissions, "payroll.approve", "all")).toBe(true);
    expect(hasScope(SYSTEM_ROLES.FINANCE.permissions, "payroll.read", "all")).toBe(true);
    expect(resolveScope(SYSTEM_ROLES.FINANCE.permissions, "payroll.prepare")).toBeNull();
    expect(resolveScope(SYSTEM_ROLES.FINANCE.permissions, "attendance.edit")).toBeNull();
  });

  it("HR cannot approve payroll they prepare (maker-checker) by default", () => {
    expect(hasScope(SYSTEM_ROLES.HR_ADMIN.permissions, "payroll.prepare", "all")).toBe(true);
    expect(resolveScope(SYSTEM_ROLES.HR_ADMIN.permissions, "payroll.approve")).toBeNull();
  });

  it("everyone can request a loan; only HR and Finance manage loans", () => {
    for (const key of ["EMPLOYEE", "MANAGER", "HR_ADMIN", "FINANCE"] as const) {
      expect(hasScope(SYSTEM_ROLES[key].permissions, "loan.request", "self"), key).toBe(true);
    }
    expect(resolveScope(SYSTEM_ROLES.EMPLOYEE.permissions, "loan.read")).toBe("self");
    expect(resolveScope(SYSTEM_ROLES.MANAGER.permissions, "loan.read")).toBe("team");
    expect(resolveScope(SYSTEM_ROLES.MANAGER.permissions, "loan.manage")).toBeNull();
    expect(resolveScope(SYSTEM_ROLES.EMPLOYEE.permissions, "loan.manage")).toBeNull();
    for (const key of ["HR_ADMIN", "FINANCE", "SUPER_ADMIN"] as const) {
      expect(hasScope(SYSTEM_ROLES[key].permissions, "loan.manage", "all"), key).toBe(true);
      expect(hasScope(SYSTEM_ROLES[key].permissions, "loan.read", "all"), key).toBe(true);
    }
  });
});
