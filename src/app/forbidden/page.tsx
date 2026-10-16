import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Access denied" };

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
      <p className="max-w-sm text-sm text-muted-foreground">If you think you should, ask an administrator to update your role.</p>
      <Button asChild><Link href="/dashboard">Go to dashboard</Link></Button>
    </div>
  );
}
