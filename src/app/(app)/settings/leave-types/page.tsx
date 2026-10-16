import { requirePagePermission } from "@/server/auth/session";
import { listLeaveTypes } from "@/server/services/leave";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { saveLeaveTypeAction } from "../../leave/actions";
import { RecordDialog, type DialogField } from "../record-dialog";

export const metadata = { title: "Leave types" };

function fields(t?: { name: string; code: string | null; daysPerYear: number | null; isPaid: boolean; isActive: boolean }): DialogField[] {
  return [
    { kind: "text", name: "name", label: "Name", required: true, defaultValue: t?.name, hint: "e.g. Annual Leave, Sick Leave, Casual Leave, Unpaid Leave" },
    { kind: "text", name: "code", label: "Short code", defaultValue: t?.code ?? "", hint: "Optional, e.g. AL" },
    { kind: "text", name: "daysPerYear", label: "Days per year", type: "number", min: 0, max: 366, defaultValue: t?.daysPerYear?.toString() ?? "", hint: "Working days per calendar year. Leave empty for no limit (e.g. unpaid leave)." },
    { kind: "checkbox", name: "isPaid", label: "Paid leave (not deducted from salary)", defaultChecked: t?.isPaid ?? true },
    { kind: "checkbox", name: "isActive", label: "Active", defaultChecked: t?.isActive ?? true },
  ];
}

export default async function LeaveTypesPage() {
  await requirePagePermission("settings.organisation", "all");
  const types = await listLeaveTypes(true);
  return (
    <>
      <PageHeader
        title="Leave types"
        description="Each type has a yearly allowance (working days, calendar year) and is either paid or unpaid. Unpaid leave days are deducted at the per-day rate in payroll."
        actions={<RecordDialog title="Add leave type" trigger="Add leave type" triggerVariant="default" action={saveLeaveTypeAction} fields={fields()} />}
      />
      {types.length === 0 ? (
        <EmptyState title="No leave types yet" description="Add the leave types RFS offers and how many days each allows per year." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Leave type</TableHead><TableHead>Paid</TableHead><TableHead className="text-right">Days / year</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {types.map((t) => (
                <TableRow key={t.id} className={t.isActive ? undefined : "text-muted-foreground"}>
                  <TableCell className="font-medium">{t.name}{t.code ? <span className="ml-1 text-xs text-muted-foreground">({t.code})</span> : null}{!t.isActive && " (inactive)"}</TableCell>
                  <TableCell>{t.isPaid ? "Paid" : "Unpaid"}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.daysPerYear ?? "No limit"}</TableCell>
                  <TableCell className="text-right">
                    <RecordDialog title="Edit leave type" trigger="Edit" triggerVariant="ghost" id={t.id} action={saveLeaveTypeAction} fields={fields(t)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
