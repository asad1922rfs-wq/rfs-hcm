import { z } from "zod";
import { loanReportWorkbook } from "@/server/services/reports";
import { optionalId, xlsxReport } from "../xlsx-response";

export const dynamic = "force-dynamic";

const schema = z.object({ employee: optionalId, department: optionalId });

/** Loans with paid / outstanding and every repayment. ?employee=<id>&department=<id> (both optional = all). */
export function GET(req: Request) {
  return xlsxReport(req, schema, (actor, q) => loanReportWorkbook(actor, { employeeId: q.employee, departmentId: q.department }));
}
