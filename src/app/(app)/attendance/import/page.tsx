import { requirePagePermission } from "@/server/auth/session";
import { attendanceSyncStatus, recentImports } from "@/server/services/attendance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetailList, EmptyState, PageHeader } from "@/components/common";
import { formatDateTime } from "@/lib/format";
import { ImportForm } from "../import-form";

export const metadata = { title: "Import attendance" };

export default async function AttendancePage() {
  await requirePagePermission("attendance.manage", "all");
  const [status, imports] = await Promise.all([attendanceSyncStatus(), recentImports()]);

  return (
    <>
      <PageHeader
        title="Import attendance"
        description="Bring biometric punches into RFS HCM. The automatic office sync agent replaces manual imports in Phase 2."
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Import attendance log</CardTitle>
            <CardDescription>
              On the ZKTeco machine: Menu → USB Manager → Download → Attendance Data. Or export transactions from ZKBioTime.
            </CardDescription>
          </CardHeader>
          <CardContent><ImportForm /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sync status</CardTitle></CardHeader>
          <CardContent>
            <DetailList
              items={[
                { label: "Latest punch received", value: status.lastPunchAt ? formatDateTime(status.lastPunchAt) : "None yet" },
                { label: "Last import", value: status.lastImport ? formatDateTime(status.lastImport.createdAt) : "None yet" },
                { label: "Unlinked device user IDs", value: status.unmatched.length },
              ]}
            />
            {status.unmatched.length > 0 && (
              <ul className="mt-4 grid gap-1 text-sm">
                {status.unmatched.slice(0, 15).map((u) => (
                  <li key={u.deviceUserId} className="flex justify-between">
                    <span className="font-mono">{u.deviceUserId}</span>
                    <span className="text-muted-foreground">{u._count._all} punches</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Import history</h2>
      {imports.length === 0 ? (
        <EmptyState title="No imports yet" />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>File</TableHead>
                <TableHead className="hidden md:table-cell">Punch range</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Invalid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {imports.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap">{formatDateTime(i.createdAt)}</TableCell>
                  <TableCell className="max-w-48 truncate">{i.fileName}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {formatDateTime(i.firstPunchAt)} → {formatDateTime(i.lastPunchAt)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.inserted}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.duplicates}</TableCell>
                  <TableCell className="hidden sm:table-cell text-right tabular-nums">{i.invalid}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
