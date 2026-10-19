import { cn } from "@/lib/utils";

const STYLES: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-warning/20 text-warning-foreground dark:text-warning" },
  APPROVED: { label: "Active", className: "bg-info/10 text-info" },
  COMPLETED: { label: "Completed", className: "bg-success/15 text-success" },
  REJECTED: { label: "Rejected", className: "bg-destructive/10 text-destructive" },
  CANCELLED: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
};

export function LoanStatusBadge({ status }: { status: string }) {
  const s = STYLES[status] ?? { label: status, className: "bg-muted" };
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", s.className)}>{s.label}</span>;
}
