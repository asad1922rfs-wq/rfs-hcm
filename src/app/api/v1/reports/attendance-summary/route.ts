import { z } from "zod";
import { attendanceSummaryWorkbook } from "@/server/services/reports";
import { monthParam, optionalId, xlsxReport } from "../xlsx-response";

export const dynamic = "force-dynamic";

const schema = z.object({ month: monthParam, department: optionalId });

/** Monthly attendance summary: one row per employee in the viewer's scope. ?month=YYYY-MM&department=<id> */
export function GET(req: Request) {
  return xlsxReport(req, schema, (actor, q) => attendanceSummaryWorkbook(actor, q.month.year, q.month.month, q.department));
}
