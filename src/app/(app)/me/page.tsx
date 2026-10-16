import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireActor } from "@/server/auth/session";
import { getEmployeeProfile } from "@/server/services/employees";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, PageHeader } from "@/components/common";
import { formatDate } from "@/lib/format";
import { SelfProfileForm } from "./self-form";

export const metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const actor = await requireActor();
  if (!actor.employeeId) redirect("/dashboard");
  const { employee: e } = await getEmployeeProfile(actor, actor.employeeId);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="My profile"
        description={`${e.employeeCode} · ${e.designation?.title ?? "—"} · ${e.department?.name ?? "—"}`}
        actions={<Button asChild variant="outline"><Link href={`/employees/${e.id}`}>View full profile</Link></Button>}
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
            <CardDescription>Contact HR to correct any of these details.</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Full name", value: e.fullName },
                { label: "Email", value: e.email },
                { label: "Joining date", value: formatDate(e.joiningDate) },
                { label: "Reporting manager", value: e.manager?.fullName },
              ]}
            />
          </CardContent>
        </Card>
        {can(actor, "profile.update", "self") && (
          <Card>
            <CardHeader>
              <CardTitle>Contact details</CardTitle>
              <CardDescription>You can update these yourself.</CardDescription>
            </CardHeader>
            <CardContent>
              <SelfProfileForm
                phone={e.phone ?? ""}
                address={e.address ?? ""}
                contacts={e.emergencyContacts.map((c) => ({ name: c.name, relationship: c.relationship, phone: c.phone }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
