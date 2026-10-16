"use client";

import { useActionState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/form";
import { removeLogoAction, uploadLogoAction } from "../actions";

export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const router = useRouter();
  const [state, action] = useActionState(uploadLogoAction, null);
  const [removing, start] = useTransition();
  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message);
      router.refresh();
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>Used as the browser icon, in the sidebar, on the sign-in page and on PDF payslips. Square images work best (at least 256×256). PNG or JPG appears on payslips; SVG/WEBP is used on screen only.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-6">
        <div className="flex size-24 items-center justify-center rounded-lg border bg-muted/40">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- small uploaded logo served by our own API
            <img src={logoUrl} alt="Company logo" className="size-20 object-contain" />
          ) : (
            <span className="size-4 rounded-full bg-primary" aria-label="No logo yet" />
          )}
        </div>
        <form action={action} className="grid gap-2">
          {state && !state.ok && <FormMessage state={state} />}
          <Input type="file" name="logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" required className="max-w-xs" />
          <div className="flex gap-2">
            <SubmitButton>{logoUrl ? "Replace logo" : "Upload logo"}</SubmitButton>
            {logoUrl && (
              <Button
                type="button"
                variant="ghost"
                disabled={removing}
                onClick={() => start(async () => {
                  const r = await removeLogoAction();
                  if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error);
                })}
              >
                Remove
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
