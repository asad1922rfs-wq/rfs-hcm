import { z } from "zod";
import { dailyDetailWorkbook } from "@/server/services/reports";
import { dateParam, optionalId, xlsxReport } from "../xlsx-response";

export const dynamic = "force-dynamic";

const schema = z.object({ from: dateParam, to: dateParam, department: optionalId, employee: optionalId });

/** Daily attendance detail, one row per employee per day. ?from=YYYY-MM-DD&to=YYYY-MM-DD (at most 62 days) */
export function GET(req: Request) {
  return xlsxReport(req, schema, (actor, q) => dailyDetailWorkbook(actor, q.from, q.to, { departmentId: q.department, employeeId: q.employee }));
}
