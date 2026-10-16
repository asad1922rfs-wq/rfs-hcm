import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { getCompany } from "@/server/services/organisation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getActor()) redirect("/dashboard");
  const [{ next }, company] = await Promise.all([searchParams, getCompany()]);

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary font-bold text-sidebar-primary-foreground">
            {company.shortName.slice(0, 3)}
          </span>
          <span className="text-lg font-semibold text-sidebar-accent-foreground">{company.shortName} HCM</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight text-sidebar-accent-foreground">People, attendance and payroll in one place.</p>
          <p className="mt-4 text-sm text-sidebar-foreground/70">{company.legalName}</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">Authorised users only. All activity is logged.</p>
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="text-lg font-semibold">{company.shortName} HCM</p>
            <p className="text-sm text-muted-foreground">{company.legalName}</p>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use your work email or Employee ID.</p>
          <LoginForm next={next} />
          <p className="mt-6 text-xs text-muted-foreground">Forgot your password? Ask HR to reset it.</p>
        </div>
      </div>
    </div>
  );
}
