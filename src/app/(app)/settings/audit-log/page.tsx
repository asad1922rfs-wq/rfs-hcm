import Link from "next/link";
import { requirePagePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  await requirePagePermission("audit.read", "all");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.action ? { action: { startsWith: sp.action.trim() } } : {};
  const [total, rows] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/settings/audit-log?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), page: String(p) })}`;

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins and data changes. Entries cannot be edited or deleted." />
      <form className="mb-4 flex gap-2" role="search">
        <Input name="action" defaultValue={sp.action} placeholder="Filter by action prefix, e.g. employee. or auth." className="max-w-sm" />
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No entries" />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When (PKT)</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="hidden md:table-cell">Record</TableHead>
                <TableHead className="hidden lg:table-cell">IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id.toString()}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell>{r.actorName ?? "System"}</TableCell>
                  <TableCell>
                    <code className="text-xs">{r.action}</code>
                    {(r.before !== null || r.after !== null) && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
                        <pre className="mt-1 max-h-64 max-w-[60vw] overflow-auto rounded bg-muted p-2 text-[11px]">
                          {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                        </pre>
                      </details>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {r.entityType === "Employee" && r.entityId ? (
                      <Link href={`/employees/${r.entityId}`} className="text-xs hover:underline">{r.entityType}</Link>
                    ) : (
                      <span className="text-xs">{r.entityType}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{r.ip ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {page} of {pageCount}</span>
          <div className="flex gap-2">
            {page > 1 && <Button asChild variant="outline" size="sm"><Link href={href(page - 1)}>Previous</Link></Button>}
            {page < pageCount && <Button asChild variant="outline" size="sm"><Link href={href(page + 1)}>Next</Link></Button>}
          </div>
        </nav>
      )}
    </>
  );
}
