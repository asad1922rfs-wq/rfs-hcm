import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/server/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const actor = await requireActor({ allowPendingPasswordChange: true });
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{actor.mustChangePassword ? "Set a new password" : "Change password"}</CardTitle>
          <CardDescription>
            {actor.mustChangePassword
              ? "You signed in with a temporary password. Choose your own password to continue."
              : "Changing your password signs you out on every other device."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
          {!actor.mustChangePassword && (
            <Link href="/dashboard" className="mt-4 block text-center text-sm text-muted-foreground hover:underline">Back to dashboard</Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
