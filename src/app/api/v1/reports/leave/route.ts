import { z } from "zod";
import { leaveReportWorkbook } from "@/server/services/reports";
import { optionalId, xlsxReport, yearParam } from "../xlsx-response";

export const dynamic = "force-dynamic";

const schema = z.object({ year: yearParam, department: optionalId });

/** Leave taken and pending per employee per leave type for a calendar year. ?year=YYYY&department=<id> */
export function GET(req: Request) {
  return xlsxReport(req, schema, (actor, q) => leaveReportWorkbook(actor, q.year, q.department));
}
