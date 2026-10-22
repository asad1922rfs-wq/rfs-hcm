import type { Actor } from "@/server/auth/session";
import { hasScope, type Permission, type Scope } from "@/server/auth/permissions";

export type NavIcon =
  | "dashboard" | "employees" | "profile" | "attendance" | "leave" | "payroll" | "payslips" | "reports"
  | "devices" | "company" | "organisation" | "shifts" | "users" | "roles" | "audit" | "holidays" | "loans";

/** `badge`: pending items waiting for the actor (shown as a pill). */
export type NavItem = { href: string; label: string; icon: NavIcon; soon?: boolean; badge?: number };
export type NavSection = { title: string; items: NavItem[] };

type Grant = { permission: Permission; scope?: Scope };
/** `anyOf`: shown when the actor has at least one of these grants. */
/** `selfOnlyWhen`: an actor with only the self scope of `permission` sees the item only when this flag is set. */
type Rule = Omit<NavItem, "badge"> & { permission?: Permission; scope?: Scope; anyOf?: Grant[]; requiresEmployee?: boolean; selfOnlyWhen?: "hasOwnLoans" };

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
      {
        href: "/attendance/requests", label: "Attendance requests", icon: "attendance",
        anyOf: [{ permission: "attendance.request", scope: "self" }, { permission: "attendance.approve", scope: "team" }],
      },
      { href: "/leave", label: "Leave", icon: "leave", permission: "leave.read" },
    ],
  },
  {
    title: "Payroll",
    items: [
      { href: "/payroll", label: "Payroll", icon: "payroll", permission: "payroll.read", scope: "all" },
      { href: "/payslips", label: "Payslips", icon: "payslips", permission: "payslip.read", requiresEmployee: true },
      { href: "/loans", label: "Loans", icon: "loans", permission: "loan.read", selfOnlyWhen: "hasOwnLoans" },
      { href: "/reports", label: "Reports", icon: "reports", permission: "report.read", scope: "team" },
    ],
  },
  {
    title: "Administration",
    items: [
      { href: "/settings/company", label: "Company", icon: "company", permission: "settings.company", scope: "all" },
      { href: "/settings/organisation", label: "Departments & titles", icon: "organisation", permission: "settings.organisation", scope: "all" },
      { href: "/settings/shifts", label: "Shifts", icon: "shifts", permission: "settings.organisation", scope: "all" },
      { href: "/settings/holidays", label: "Holidays", icon: "holidays", permission: "settings.organisation", scope: "all" },
      { href: "/settings/leave-types", label: "Leave types", icon: "leave", permission: "settings.organisation", scope: "all" },
      { href: "/settings/devices", label: "Biometric devices", icon: "devices", permission: "device.manage", scope: "all" },
      { href: "/settings/users", label: "Users", icon: "users", permission: "user.manage", scope: "all" },
      { href: "/settings/roles", label: "Roles & permissions", icon: "roles", permission: "role.manage", scope: "all" },
    ],
  },
];

export function navigationFor(actor: Actor, badges: Record<string, number> = {}, flags: { hasOwnLoans?: boolean } = {}): NavSection[] {
  return SECTIONS.map((section) => ({
    title: section.title,
    items: section.items
      .filter((i) =>
        (!i.permission || hasScope(actor.grants, i.permission, i.scope))
        && (!i.anyOf || i.anyOf.some((g) => hasScope(actor.grants, g.permission, g.scope)))
        && (!i.requiresEmployee || actor.employeeId)
        && (!i.selfOnlyWhen || !i.permission || hasScope(actor.grants, i.permission, "team") || hasScope(actor.grants, "loan.manage", "all") || flags[i.selfOnlyWhen]))
      .map(({ href, label, icon, soon }) => ({ href, label, icon, soon, ...(badges[href] ? { badge: badges[href] } : {}) })),
  })).filter((s) => s.items.length > 0);
}
