import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePagePermission } from "@/server/auth/session";
import { listHolidays } from "@/server/services/holidays";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/common";
import { todayInPKT } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { RecordDialog, type DialogField } from "../record-dialog";
import { saveHolidayAction } from "./actions";
import { DeleteHolidayButton, LoadPakistanHolidaysButton } from "./holiday-buttons";

export const metadata = { title: "Holidays" };

function fields(year: number): DialogField[] {
  return [
    { kind: "text", name: "date", label: "Date", type: "date", required: true, defaultValue: `${year}-01-01` },
    { kind: "text", name: "name", label: "Name", required: true, hint: "e.g. Eid-ul-Fitr (day 1)" },
  ];
}

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requirePagePermission("settings.organisation", "all");
  const sp = await searchParams;
  const current = todayInPKT().getUTCFullYear();
  const requested = Number(sp.year);
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : current;
  const holidays = await listHolidays(year);

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Public holidays are off days for everyone, just like the weekend: nobody is marked absent, no pay is deducted and leave does not count them."
        actions={
          <>
            <LoadPakistanHolidaysButton year={year} />
            <RecordDialog
              title="Add holiday"
              description="Saving a date that already has a holiday renames it."
              trigger="Add holiday"
              triggerVariant="default"
              action={saveHolidayAction}
              fields={fields(year)}
            />
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Previous year"><Link href={`/settings/holidays?year=${year - 1}`}><ChevronLeft /></Link></Button>
        <span className="min-w-14 text-center font-medium tabular-nums">{year}</span>
        <Button asChild variant="outline" size="icon" aria-label="Next year"><Link href={`/settings/holidays?year=${year + 1}`}><ChevronRight /></Link></Button>
        {year !== current && <Button asChild variant="ghost"><Link href="/settings/holidays">This year</Link></Button>}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Eid-ul-Fitr, Eid-ul-Adha, Ashura (9–10 Muharram) and Eid Milad-un-Nabi follow the moon. Add them by hand once the government announces the dates.
      </p>
      {holidays.length === 0 ? (
        <EmptyState title={`No holidays for ${year} yet`} description="Load the fixed national holidays, then add the moon-based ones when they are announced." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead className="hidden sm:table-cell">Day</TableHead><TableHead>Holiday</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="tabular-nums">{formatDate(h.date)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">{h.date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}</TableCell>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell className="text-right">
                    <DeleteHolidayButton id={h.id} label={h.name} />
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
