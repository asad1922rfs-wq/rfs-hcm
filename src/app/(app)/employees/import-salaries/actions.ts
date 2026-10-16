"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/action";
import { commitSalaryImport, previewSalaryImport, type SalaryPreviewRow } from "@/server/services/salary-import";
import { AppError, type ActionResult } from "@/server/errors";

export type SalaryImportState = { mode: "preview" | "done"; rows: SalaryPreviewRow[]; saved?: number };

export async function salaryImportAction(_prev: ActionResult<SalaryImportState> | null, fd: FormData): Promise<ActionResult<SalaryImportState>> {
  return runAction<SalaryImportState>(async () => {
    const actor = await requireActor();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.name) throw new AppError("Choose the filled-in salary .xlsx file.");
    if (fd.get("intent") === "import") {
      const r = await commitSalaryImport(actor, file);
      revalidatePath("/employees");
      revalidatePath("/dashboard");
      return { ok: true, data: { mode: "done", rows: r.preview, saved: r.saved } };
    }
    return { ok: true, data: { mode: "preview", rows: await previewSalaryImport(actor, file) } };
  });
}
