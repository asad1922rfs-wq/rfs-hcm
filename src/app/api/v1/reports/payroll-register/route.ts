import { z } from "zod";
import { payrollRegisterWorkbook } from "@/server/services/reports";
import { xlsxReport } from "../xlsx-response";

export const dynamic = "force-dynamic";

const schema = z.object({ run: z.string({ error: "Choose a payroll." }).trim().min(1, "Choose a payroll.").max(40) });

/** Payroll register + bank transfer sheet for one payroll run. ?run=<payrollRunId> */
export function GET(req: Request) {
  return xlsxReport(req, schema, (actor, q) => payrollRegisterWorkbook(actor, q.run));
}
