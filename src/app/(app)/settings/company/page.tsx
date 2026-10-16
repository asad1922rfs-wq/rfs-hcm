import { requirePagePermission } from "@/server/auth/session";
import { getCompany } from "@/server/services/organisation";
import { PageHeader } from "@/components/common";
import { CompanyForm } from "./company-form";
import { LogoForm } from "./logo-form";
import { logoUrl } from "@/server/services/branding";

export const metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  await requirePagePermission("settings.company", "all");
  const company = await getCompany();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Company" description="Shown on payslips, reports and the sign-in page." />
      <div className="mb-6"><LogoForm logoUrl={logoUrl(company)} /></div>
      <CompanyForm
        company={{
          legalName: company.legalName,
          shortName: company.shortName,
          address: company.address ?? "",
          phone: company.phone ?? "",
          email: company.email ?? "",
          website: company.website ?? "",
          ntn: company.ntn ?? "",
          weekendDays: company.weekendDays,
          timezone: company.timezone,
          currency: company.currency,
        }}
      />
    </div>
  );
}
