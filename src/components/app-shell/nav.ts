import type { Actor } from "@/server/auth/session";
import { hasScope, type Permission, type Scope } from "@/server/auth/permissions";

export type NavIcon =
  | "dashboard" | "employees" | "profile" | "attendance" | "leave" | "payroll" | "payslips" | "reports"
  | "devices" | "company" | "organisation" | "shifts" | "users" | "roles" | "audit";

export type NavItem = { href: string; label: string; icon: NavIcon; soon?: boolean };
export type NavSection = { title: string; items: NavItem[] };

type Rule = NavItem & { permission?: Permission; scope?: Scope; requiresEmployee?: boolean };

const SECTIONS: { title: string; items: Rule[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/me", label: "My profile", icon: "profile", requiresEmployee: true },
    ],
  },
  {
    title: "People",
    items: [
      { href: "/employees", label: "Employees", icon: "employees", permission: "employee.read", scope: "team" },
      { href: "/attendance", label: "Attendance", icon: "attendance", permission: "attendance.read", scope: "team" },
      { href: "/leave", label: "Leave", icon: "leave", permission: "leave.read", soon: true },
    ],
  },
  {
    title: "Payroll",
    items: [
      { href: "/payroll", label: "Payroll", icon: "payroll", permission: "payroll.read", scope: "all" },
      { href: "/payslips", label: "Payslips", icon: "payslips", permission: "payslip.read", soon: true },
      { href: "/reports", label: "Reports", icon: "reports", permission: "report.read", scope: "team", soon: true },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/settings/company", label: "Company", icon: "company", permission: "settings.company", scope: "all" },
      { href: "/settings/organisation", label: "Departments & titles", icon: "organisation", permission: "settings.organisation", scope: "all" },
      { href: "/settings/shifts", label: "Shifts", icon: "shifts", permission: "settings.organisation", scope: "all" },
      { href: "/settings/devices", label: "Biometric devices", icon: "devices", permission: "device.manage", scope: "all" },
      { href: "/settings/users", label: "Users", icon: "users", permission: "user.manage", scope: "all" },
      { href: "/settings/roles", label: "Roles & permissions", icon: "roles", permission: "role.manage", scope: "all" },
      { href: "/settings/audit-log", label: "Audit log", icon: "audit", permission: "audit.read", scope: "all" },
    ],
  },
];

export function navigationFor(actor: Actor): NavSection[] {
  return SECTIONS.map((section) => ({
    title: section.title,
    items: section.items
      .filter((i) => (!i.permission || hasScope(actor.grants, i.permission, i.scope)) && (!i.requiresEmployee || actor.employeeId))
      .map(({ href, label, icon, soon }) => ({ href, label, icon, soon })),
  })).filter((s) => s.items.length > 0);
}
