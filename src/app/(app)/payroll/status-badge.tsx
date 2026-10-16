import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-foreground",
  SUBMITTED: "bg-info/15 text-info",
  APPROVED: "bg-success/15 text-success",
  PAID: "bg-primary/15 text-primary",
};
const LABELS: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Awaiting Finance approval", APPROVED: "Approved · locked", PAID: "Paid" };

export function PayrollStatusBadge({ status }: { status: string }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", STYLES[status])}>{LABELS[status] ?? status}</span>;
}
