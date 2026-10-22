// Permission catalogue and scope resolution.
//
// A grant is "<permission>:<scope>", e.g. "employee.read:team". The special grant "*" means every permission at
// scope "all". Scopes are ordered: self < team < department < all. Grants are stored on Role.permissions, so
// Super Admin can change what each role can do without a code change.

export const SCOPES = ["self", "team", "department", "all"] as const;
export type Scope = (typeof SCOPES)[number];

type PermissionDef = { label: string; group: string; scopes: readonly Scope[] };

export const PERMISSIONS = {
  "employee.read": { group: "Employees", label: "View employee profiles", scopes: SCOPES },
  "employee.manage": { group: "Employees", label: "Create, edit, activate and deactivate employees", scopes: ["all"] },
  "employee.delete": { group: "Employees", label: "Permanently delete employees", scopes: ["all"] },
  "salary.read": { group: "Compensation", label: "View salary and allowances", scopes: ["self", "team", "department", "all"] },
  "salary.manage": { group: "Compensation", label: "Change salary and allowances", scopes: ["all"] },
  "bank.read": { group: "Compensation", label: "View bank details (decrypted)", scopes: ["self", "all"] },
  "bank.manage": { group: "Compensation", label: "Change bank details", scopes: ["all"] },
  "profile.update": { group: "Self-service", label: "Update permitted personal information", scopes: ["self"] },
  "attendance.read": { group: "Attendance", label: "View attendance", scopes: SCOPES },
  "attendance.manage": { group: "Attendance", label: "Manage attendance and corrections", scopes: ["all"] },
  "attendance.edit": { group: "Attendance", label: "Edit attendance times (check-in / check-out)", scopes: ["all"] },
  "attendance.request": { group: "Attendance", label: "Request a late waiver (attendance request)", scopes: ["self"] },
  "attendance.approve": { group: "Attendance", label: "Approve attendance requests (late waivers)", scopes: ["team", "department", "all"] },
  "leave.read": { group: "Leave", label: "View leave", scopes: SCOPES },
  "leave.request": { group: "Leave", label: "Request leave", scopes: ["self"] },
  "leave.approve": { group: "Leave", label: "Approve leave", scopes: ["team", "department", "all"] },
  "payroll.read": { group: "Payroll", label: "View payroll runs and employee pay", scopes: ["all"] },
  "payroll.prepare": { group: "Payroll", label: "Prepare and calculate payroll", scopes: ["all"] },
  "payroll.approve": { group: "Payroll", label: "Approve and lock payroll", scopes: ["all"] },
  "payslip.read": { group: "Payroll", label: "View and download payslips", scopes: ["self", "all"] },
  "payslip.manage": { group: "Payroll", label: "Generate payslips", scopes: ["all"] },
  "loan.read": { group: "Loans", label: "View loans and repayments", scopes: SCOPES },
  "loan.manage": { group: "Loans", label: "Add, approve, adjust installments, record repayments and cancel loans", scopes: ["all"] },
  "document.read": { group: "Documents", label: "View and download employee documents", scopes: SCOPES },
  "document.manage": { group: "Documents", label: "Upload and delete employee documents", scopes: ["all"] },
  "report.read": { group: "Reports", label: "View and export reports", scopes: ["team", "department", "all"] },
  "settings.company": { group: "Administration", label: "Company settings", scopes: ["all"] },
  "settings.organisation": { group: "Administration", label: "Departments, designations, shifts", scopes: ["all"] },
  "settings.payroll": { group: "Administration", label: "Payroll and attendance policies", scopes: ["all"] },
  "device.manage": { group: "Administration", label: "Biometric devices and sync agents", scopes: ["all"] },
  "user.manage": { group: "Administration", label: "User accounts", scopes: ["all"] },
  "role.manage": { group: "Administration", label: "Roles and permissions", scopes: ["all"] },
  "audit.read": { group: "Administration", label: "View audit log", scopes: ["all"] },
} as const satisfies Record<string, PermissionDef>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const scopeRank = (s: Scope) => SCOPES.indexOf(s);

export function isValidGrant(grant: string): boolean {
  if (grant === "*") return true;
  const [perm, scope] = grant.split(":");
  const def = PERMISSIONS[perm as Permission] as PermissionDef | undefined;
  return !!def && def.scopes.includes(scope as Scope);
}

/** Highest scope granted for a permission, or null if not granted at all. */
export function resolveScope(grants: readonly string[], permission: Permission): Scope | null {
  if (grants.includes("*")) return "all";
  let best: Scope | null = null;
  for (const grant of grants) {
    const [perm, scope] = grant.split(":");
    if (perm !== permission || !SCOPES.includes(scope as Scope)) continue;
    if (best === null || scopeRank(scope as Scope) > scopeRank(best)) best = scope as Scope;
  }
  return best;
}

export function hasScope(grants: readonly string[], permission: Permission, atLeast: Scope = "self"): boolean {
  const scope = resolveScope(grants, permission);
  return scope !== null && scopeRank(scope) >= scopeRank(atLeast);
}

// Default roles, seeded on first install. Super Admin can edit all roles except Super Admin itself.
export const SYSTEM_ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Complete system control",
    permissions: ["*"],
  },
  HR_ADMIN: {
    name: "HR Admin",
    description: "Employee records, attendance, leave, payroll preparation, payslips and reports",
    permissions: [
      "employee.read:all", "employee.manage:all", "salary.read:all", "salary.manage:all",
      "profile.update:self", "attendance.read:all", "attendance.manage:all", "attendance.approve:all", "attendance.request:self",
      "leave.read:all", "leave.request:self", "leave.approve:all", "payroll.read:all", "payroll.prepare:all",
      "payslip.read:all", "payslip.manage:all", "report.read:all", "settings.organisation:all",
      "user.manage:all", "audit.read:all", "bank.read:self", "loan.read:all", "loan.manage:all",
      "document.read:all", "document.manage:all",
    ],
  },
  FINANCE: {
    name: "Finance",
    description: "Reviews and approves payroll, sees salaries and bank details for payment, payroll reports",
    permissions: [
      "employee.read:all", "salary.read:all", "bank.read:all", "attendance.read:all", "attendance.request:self",
      "leave.read:self", "leave.request:self", "payroll.read:all", "payroll.approve:all", "payslip.read:all", "report.read:all",
      "loan.read:all", "loan.manage:all", "document.read:self",
    ],
  },
  MANAGER: {
    name: "Manager",
    description: "Team attendance, team leave approvals and department reports",
    permissions: [
      "employee.read:team", "salary.read:self", "bank.read:self",
      "attendance.read:team", "attendance.approve:team", "attendance.request:self", "leave.read:team", "leave.request:self",
      "leave.approve:team", "payslip.read:self", "report.read:team", "loan.read:team",
      "document.read:self",
    ],
  },
  EMPLOYEE: {
    name: "Employee",
    description: "Personal dashboard, own attendance, salary, payslips and leave requests",
    permissions: [
      "employee.read:self", "salary.read:self", "bank.read:self",
      "attendance.read:self", "attendance.request:self", "leave.read:self", "leave.request:self", "payslip.read:self", "loan.read:self",
      "document.read:self",
    ],
  },
} as const satisfies Record<string, { name: string; description: string; permissions: readonly string[] }>;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;
