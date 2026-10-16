"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { runAction } from "@/server/action";
import { importPunchFile } from "@/server/services/attendance";
import { AppError, type ActionResult } from "@/server/errors";

export type ImportSummary = {
  fileName: string; rowsRead: number; inserted: number; duplicates: number; invalid: number; unmatchedIds: string[]; errors: string[];
};

export async function importPunchesAction(_prev: ActionResult<ImportSummary> | null, fd: FormData): Promise<ActionResult<ImportSummary>> {
  return runAction(async () => {
    const actor = await requireActor();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.name) throw new AppError("Choose an attendance log file to import.");
    const r = await importPunchFile(actor, file);
    revalidatePath("/attendance");
    revalidatePath("/dashboard");
    return {
      ok: true,
      data: { fileName: r.fileName, rowsRead: r.rowsRead, inserted: r.inserted, duplicates: r.duplicates, invalid: r.invalid, unmatchedIds: r.unmatchedIds, errors: r.errors },
    };
  });
}
