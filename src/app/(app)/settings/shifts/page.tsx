import { requirePagePermission } from "@/server/auth/session";
import { listShifts } from "@/server/services/organisation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/common";
import { formatMinuteOfDay, minuteToTimeInput } from "@/lib/format";
import { saveShiftAction, saveShiftOverrideAction } from "../actions";
import { RecordDialog, type DialogField } from "../record-dialog";
import { RemoveOverrideButton } from "./override-remove";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const metadata = { title: "Shifts" };

function shiftFields(s?: { name: string; startMinute: number; endMinute: number; graceMinutes: number; isDefault: boolean; isActive: boolean }): DialogField[] {
  return [
    { kind: "text", name: "name", label: "Name", required: true, defaultValue: s?.name },
    { kind: "text", name: "start", label: "Start time", type: "time", required: true, defaultValue: s ? minuteToTimeInput(s.startMinute) : "14:00" },
    { kind: "text", name: "end", label: "End time", type: "time", required: true, defaultValue: s ? minuteToTimeInput(s.endMinute) : "23:00", hint: "An end time earlier than the start means the shift ends after midnight." },
    { kind: "text", name: "graceMinutes", label: "Late grace period (minutes)", type: "number", required: true, min: 0, max: 240, defaultValue: String(s?.graceMinutes ?? 15), hint: "Arrivals after start + grace are counted as late." },
    { kind: "checkbox", name: "isDefault", label: "Default shift for new employees", defaultChecked: s?.isDefault ?? false },
    { kind: "checkbox", name: "isActive", label: "Active", defaultChecked: s?.isActive ?? true },
  ];
}

export default async function ShiftsPage() {
  await requirePagePermission("settings.organisation", "all");
  const shifts = await listShifts();

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Office timings used for attendance, including day-specific timings such as Friday. Late is counted after the grace period."
        actions={<RecordDialog title="Add shift" trigger="Add shift" triggerVariant="default" action={saveShiftAction} fields={shiftFields()} />}
      />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shift</TableHead>
              <TableHead>Timing</TableHead>
              <TableHead className="hidden sm:table-cell">Grace</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Employees</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.map((s) => (
              <TableRow key={s.id} className={s.isActive ? undefined : "text-muted-foreground"}>
                <TableCell className="font-medium">
                  {s.name} {s.isDefault && <Badge variant="secondary" className="ml-1">Default</Badge>} {!s.isActive && "(inactive)"}
                </TableCell>
                <TableCell>
                  {formatMinuteOfDay(s.startMinute)} – {formatMinuteOfDay(s.endMinute)}
                  {s.endMinute < s.startMinute && <span className="text-muted-foreground"> (next day)</span>}
                  {s.dayOverrides.length > 0 && (
                    <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                      {s.dayOverrides.map((o) => (
                        <li key={o.id} className="flex items-center gap-1">
                          <span className="font-medium text-foreground">{DAYS[o.weekday]}:</span>
                          {formatMinuteOfDay(o.startMinute)} – {formatMinuteOfDay(o.endMinute)}
                          {o.graceMinutes !== null && ` · grace ${o.graceMinutes} min`}
                          <RemoveOverrideButton id={o.id} label={DAYS[o.weekday]!} />
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{s.graceMinutes} min</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums">{s._count.employees}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <RecordDialog
                    title={`Day-specific timing · ${s.name}`}
                    description="Use a different timing on one weekday, e.g. Friday 3:00 PM – 12:00 AM. Past attendance is recalculated."
                    trigger="Day timing"
                    triggerVariant="ghost"
                    action={saveShiftOverrideAction.bind(null, s.id)}
                    fields={[
                      { kind: "select", name: "weekday", label: "Day", defaultValue: "5", options: DAYS.map((d, i) => ({ value: String(i), label: d })) },
                      { kind: "text", name: "start", label: "Start time", type: "time", required: true, defaultValue: "15:00" },
                      { kind: "text", name: "end", label: "End time", type: "time", required: true, defaultValue: "00:00", hint: "00:00 = midnight (12:00 AM)." },
                      { kind: "text", name: "graceMinutes", label: "Grace (minutes)", type: "number", min: 0, max: 240, hint: `Leave empty to use the shift's ${s.graceMinutes} minutes.` },
                    ]}
                  />
                  <RecordDialog title="Edit shift" trigger="Edit" triggerVariant="ghost" id={s.id} action={saveShiftAction} fields={shiftFields(s)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
