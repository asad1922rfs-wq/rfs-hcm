"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/server/auth/session";
import { passwordSchema } from "@/server/auth/password";
import { formObject, runAction } from "@/server/action";
import { deleteShiftOverride, saveDepartment, saveDesignation, saveShift, saveShiftOverride, updateCompany } from "@/server/services/organisation";
import { createLoginsInBulk, createUser, resetRoleToDefault, type BulkLogin, resetUserPassword, updateRolePermissions, updateUser } from "@/server/services/users";
import { optionalId, optionalText, requiredText } from "@/lib/validation";
import { parseTimeOfDay } from "@/lib/format";
import { AppError, type ActionResult } from "@/server/errors";
import { removeCompanyLogo, saveCompanyLogo } from "@/server/services/branding";

const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const companySchema = z.object({
  legalName: requiredText("Legal name", 200),
  shortName: requiredText("Short name", 20),
  address: optionalText(300),
  phone: optionalText(40),
  email: z.preprocess((v) => (v === "" ? undefined : v), z.email("Enter a valid email.").optional()),
  website: optionalText(200),
  ntn: optionalText(30),
  attendanceStartDate: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^d{4}-d{2}-d{2}$/, "Choose a date.").nullable()),
});

export async function updateCompanyAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = companySchema.parse(formObject(fd));
    const weekendDays = fd.getAll("weekendDays").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    await updateCompany(actor, { ...input, weekendDays });
    revalidatePath("/", "layout");
    return { ok: true, message: "Company settings saved." };
  });
}

export async function saveDepartmentAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z
      .object({ id: optionalId, name: requiredText("Name", 80), code: optionalText(12), description: optionalText(200), isActive: checkbox })
      .parse({ ...formObject(fd), isActive: fd.get("isActive") });
    await saveDepartment(actor, input);
    revalidatePath("/settings/organisation");
    return { ok: true, message: "Department saved." };
  });
}

export async function saveDesignationAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z
      .object({ id: optionalId, title: requiredText("Title", 80), isActive: checkbox })
      .parse({ ...formObject(fd), isActive: fd.get("isActive") });
    await saveDesignation(actor, input);
    revalidatePath("/settings/organisation");
    return { ok: true, message: "Designation saved." };
  });
}

const time = (label: string) =>
  z.string().transform((v, ctx) => {
    try {
      return parseTimeOfDay(v);
    } catch {
      ctx.addIssue({ code: "custom", message: `${label} must be a valid time.` });
      return z.NEVER;
    }
  });

export async function saveShiftAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z
      .object({
        id: optionalId,
        name: requiredText("Name", 60),
        start: time("Start time"),
        end: time("End time"),
        graceMinutes: z.coerce.number().int().min(0, "Grace cannot be negative.").max(240, "Grace is at most 240 minutes."),
        isDefault: checkbox,
        isActive: checkbox,
      })
      .parse({ ...formObject(fd), isDefault: fd.get("isDefault"), isActive: fd.get("isActive") });
    await saveShift(actor, { id: input.id, name: input.name, startMinute: input.start, endMinute: input.end, graceMinutes: input.graceMinutes, isDefault: input.isDefault, isActive: input.isActive });
    revalidatePath("/settings/shifts");
    return { ok: true, message: "Shift saved." };
  });
}

export async function saveShiftOverrideAction(shiftId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z
      .object({
        weekday: z.coerce.number().int().min(0).max(6),
        start: time("Start time"),
        end: time("End time"),
        graceMinutes: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(0).max(240).nullable()),
      })
      .parse(formObject(fd));
    await saveShiftOverride(actor, { shiftId, weekday: input.weekday, startMinute: input.start, endMinute: input.end, graceMinutes: input.graceMinutes });
    revalidatePath("/settings/shifts");
    revalidatePath("/dashboard");
    return { ok: true, message: "Day timing saved and attendance recalculated." };
  });
}

export async function deleteShiftOverrideAction(overrideId: string): Promise<ActionResult> {
  return runAction(async () => {
    await deleteShiftOverride(await requireActor(), overrideId);
    revalidatePath("/settings/shifts");
    revalidatePath("/dashboard");
    return { ok: true, message: "Day timing removed and attendance recalculated." };
  });
}

export async function createUserAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z
      .object({
        employeeId: optionalId,
        email: z.preprocess((v) => (v === "" ? undefined : v), z.email("Enter a valid email.").optional()),
        displayName: optionalText(120),
        roleId: requiredText("Role", 40),
        temporaryPassword: passwordSchema,
      })
      .parse(formObject(fd));
    await createUser(actor, input);
    revalidatePath("/settings/users");
    return { ok: true, message: "Login created. Share the temporary password securely — it must be changed at first sign-in." };
  });
}

export async function bulkCreateLoginsAction(): Promise<ActionResult<BulkLogin[]>> {
  return runAction<BulkLogin[]>(async () => {
    const created = await createLoginsInBulk(await requireActor());
    revalidatePath("/settings/users");
    return { ok: true, data: created };
  });
}

export async function updateUserAction(userId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const input = z.object({ roleId: requiredText("Role", 40), isActive: checkbox }).parse({ roleId: fd.get("roleId"), isActive: fd.get("isActive") });
    await updateUser(actor, userId, input);
    revalidatePath("/settings/users");
    return { ok: true, message: "User updated." };
  });
}

export async function resetPasswordAction(userId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    const { temporaryPassword } = z.object({ temporaryPassword: passwordSchema }).parse(formObject(fd));
    await resetUserPassword(actor, userId, temporaryPassword);
    revalidatePath("/settings/users");
    return { ok: true, message: "Password reset. The user must choose a new password at next sign-in." };
  });
}

export async function updateRoleAction(roleId: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await requireActor();
    if (fd.get("$reset") === "1") await resetRoleToDefault(actor, roleId);
    else await updateRolePermissions(actor, roleId, fd.getAll("grants").map(String).filter(Boolean));
    revalidatePath("/settings/roles");
    return { ok: true, message: "Permissions saved." };
  });
}

export async function uploadLogoAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const file = fd.get("logo");
    if (!(file instanceof File) || !file.name) throw new AppError("Choose an image file.");
    await saveCompanyLogo(await requireActor(), file);
    revalidatePath("/", "layout");
    return { ok: true, message: "Logo updated." };
  });
}

export async function removeLogoAction(): Promise<ActionResult> {
  return runAction(async () => {
    await removeCompanyLogo(await requireActor());
    revalidatePath("/", "layout");
    return { ok: true, message: "Logo removed." };
  });
}
