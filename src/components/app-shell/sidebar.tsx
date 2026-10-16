"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2, CalendarCheck, CalendarDays, ClipboardList, Clock, Fingerprint, LayoutDashboard, Network, ReceiptText,
  ScrollText, ShieldCheck, UserCircle, UserCog, Users, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavIcon, NavSection } from "./nav";

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  employees: Users,
  profile: UserCircle,
  attendance: CalendarCheck,
  leave: CalendarDays,
  payroll: Wallet,
  payslips: ReceiptText,
  reports: ClipboardList,
  devices: Fingerprint,
  company: Building2,
  organisation: Network,
  shifts: Clock,
  users: UserCog,
  roles: ShieldCheck,
  audit: ScrollText,
};

export function SidebarNav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-6 px-3 py-4" aria-label="Main">
      {sections.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">{section.title}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              if (item.soon) {
                return (
                  <li key={item.href}>
                    <span
                      className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/40"
                      title="Coming in a later phase"
                    >
                      <Icon className="size-4" />
                      {item.label}
                      <span className="ml-auto rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] font-medium uppercase text-sidebar-foreground/60">Soon</span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Brand({ companyShortName, logoUrl }: { companyShortName: string; logoUrl?: string | null }) {
  return (
    <Link href="/dashboard" className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- small uploaded logo served by our own API
        <img src={logoUrl} alt="" className="size-8 shrink-0 object-contain" />
      ) : (
        <span aria-hidden className="size-3 shrink-0 rounded-full bg-sidebar-primary" />
      )}
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-sidebar-accent-foreground">{companyShortName} HCM</span>
        <span className="block text-[11px] text-sidebar-foreground/60">People · Attendance · Payroll</span>
      </span>
    </Link>
  );
}
