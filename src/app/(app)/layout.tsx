import { requireActor } from "@/server/auth/session";
import { getCompany } from "@/server/services/organisation";
import { logoUrl } from "@/server/services/branding";
import { navigationFor } from "@/components/app-shell/nav";
import { Brand, SidebarNav } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const company = await getCompany();
  const sections = navigationFor(actor);

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground lg:flex">
        <Brand companyShortName={company.shortName} logoUrl={logoUrl(company)} />
        <SidebarNav sections={sections} />
      </aside>
      <div className="lg:pl-64">
        <Topbar
          sections={sections}
          companyShortName={company.shortName}
          logoUrl={logoUrl(company)}
          user={{ displayName: actor.displayName, roleName: actor.roleName, email: actor.email, hasProfile: !!actor.employeeId }}
        />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
