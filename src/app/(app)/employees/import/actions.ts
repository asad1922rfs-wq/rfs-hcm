"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/action";
import { commitEmployeeImport, previewEmployeeImport, type PreviewRow } from "@/server/services/employee-import";
import { AppError, type ActionResult } from "@/server/errors";

export type ImportState = { mode: "preview" | "done"; rows: PreviewRow[]; created?: number; updated?: number; skipped?: number };

export async function employeeImportAction(_prev: ActionResult<ImportState> | null, fd: FormData): Promise<ActionResult<ImportState>> {
  return runAction<ImportState>(async () => {
    const actor = await requireActor();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.name) throw new AppError("Choose the FlowHCM employee .xlsx file.");
    if (fd.get("intent") === "import") {
      const r = await commitEmployeeImport(actor, file);
      revalidatePath("/employees");
      revalidatePath("/dashboard");
      return { ok: true, data: { mode: "done", rows: r.preview, created: r.created, updated: r.updated, skipped: r.skipped } };
    }
    return { ok: true, data: { mode: "preview", rows: await previewEmployeeImport(actor, file) } };
  });
}
