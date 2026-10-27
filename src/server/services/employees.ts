import "server-only";
import { Prisma, type EmploymentStatus } from "@prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit";
import { decryptField, encryptField, maskValue } from "@/server/crypto";
import { AppError, NotFoundError } from "@/server/errors";
import { assertPermission, can, revokeUserSessions, type Actor } from "@/server/auth/session";
import { assertEmployeeAccess, canAccessEmployee, scopedEmployeeWhere, teamEmployeeIds } from "@/server/auth/scope";
import { todayInPKT } from "@/lib/dates";
import { relinkEmployeePunches } from "@/server/services/attendance";
import { removeEmployeeDocumentFiles } from "@/server/services/documents";
import { NEW_DESIGNATION, type BankInput, type EmployeeInput, type SalaryInput } from "@/lib/validation";
import { findOrCreateDesignation } from "@/server/services/organisation";

// ───────────── Reads ─────────────

export type EmployeeListFilters = {
  q?: string;
  departmentId?: string;
  status?: EmploymentStatus | "ALL";
  page?: number;
  pageSize?: number;
};

export async function listEmployees(actor: Actor, filters: EmployeeListFilters = {}) {
  const scopeWhere = await scopedEmployeeWhere(actor, "employee.read");
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 5), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const q = filters.q?.trim();

  const where: Prisma.EmployeeWhereInput = {
    AND: [
      scopeWhere,
      filters.status && filters.status !== "ALL" ? { status: filters.status } : filters.status === "ALL" ? {} : { status: "ACTIVE" },
      filters.departmentId ? { departmentId: filters.departmentId } : {},
      q
        ? {
            OR: [
              { fullName: { contains: q } },
              { employeeCode: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {},
    ],
  };

  const [total, rows] = await Promise.all([
    db.employee.count({ where }),
    db.employee.findMany({
      where,
      orderBy: [{ fullName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, employeeCode: true, fullName: true, photoPath: true, email: true, phone: true,
        joiningDate: true, employmentType: true, status: true, deviceUserId: true,
        department: { select: { name: true } },
        designation: { select: { title: true } },
        manager: { select: { fullName: true } },
      },
    }),
  ]);

  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Salary in force on `onDate` (latest structure with effectiveFrom <= onDate). */
export async function salaryInForce(employeeId: string, onDate: Date = todayInPKT()) {
  return db.salaryStructure.findFirst({
    where: { employeeId, effectiveFrom: { lte: onDate } },
    orderBy: { effectiveFrom: "desc" },
    include: { allowances: true },
  });
}

export async function getEmployeeProfile(actor: Actor, employeeId: string) {
  await assertEmployeeAccess(actor, "employee.read", employeeId);

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      department: true,
      designation: true,
      shift: true,
      manager: { select: { id: true, fullName: true, employeeCode: true } },
      reports: { select: { id: true, fullName: true, employeeCode: true }, where: { status: "ACTIVE" }, orderBy: { fullName: "asc" } },
      emergencyContacts: true,
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true, role: { select: { name: true } } } },
    },
  });
  if (!employee) throw new NotFoundError("Employee not found.");

  const [canSeeSalary, canSeeBank] = await Promise.all([
    canAccessEmployee(actor, "salary.read", employeeId),
    canAccessEmployee(actor, "bank.read", employeeId),
  ]);

  const salaryHistory = canSeeSalary
    ? await db.salaryStructure.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" }, include: { allowances: true } })
    : null;
  const today = todayInPKT();
  const currentSalary = salaryHistory?.find((s) => s.effectiveFrom <= today) ?? null;

  const bank = canSeeBank ? await db.bankAccount.findUnique({ where: { employeeId } }) : null;
  const maskedBank = bank
    ? {
        bankName: bank.bankName,
        branch: bank.branch,
        accountTitle: bank.accountTitle,
        accountNumber: maskValue(decryptField(bank.accountNumberEnc)),
        iban: bank.ibanEnc ? maskValue(decryptField(bank.ibanEnc)) : null,
        updatedAt: bank.updatedAt,
      }
    : null;

  const { cnicEnc, ...rest } = employee;
  const canManage = can(actor, "employee.manage", "all");
  const isSelf = actor.employeeId === employeeId;

  return {
    employee: { ...rest, cnic: cnicEnc && (canManage || isSelf) ? decryptField(cnicEnc) : cnicEnc ? "•••••-•••••••-•" : null },
    salary: canSeeSalary ? { current: currentSalary, history: salaryHistory! } : null,
    bank: canSeeBank ? maskedBank : undefined,
  };
}

/** Full bank details. Every reveal is audited. */
export async function revealBankDetails(actor: Actor, employeeId: string) {
  await assertEmployeeAccess(actor, "bank.read", employeeId);
  const bank = await db.bankAccount.findUnique({ where: { employeeId } });
  if (!bank) throw new NotFoundError("No bank details on file.");
  await recordAudit({ actor, action: "bank.reveal", entityType: "Employee", entityId: employeeId });
  return { accountNumber: decryptField(bank.accountNumberEnc), iban: bank.ibanEnc ? decryptField(bank.ibanEnc) : null };
}

export async function employeeFormOptions() {
  const [departments, designations, shifts, managers] = await Promise.all([
    db.department.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.designation.findMany({ where: { isActive: true }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    db.shift.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, startMinute: true, endMinute: true, isDefault: true } }),
    db.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, employeeCode: true } }),
  ]);
  return { departments, designations, shifts, managers };
}

/** Suggest the next Employee ID in the RFS-0001 sequence. */
export async function suggestEmployeeCode(): Promise<string> {
  const rows = await db.employee.findMany({ where: { employeeCode: { startsWith: "RFS-" } }, select: { employeeCode: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.employeeCode.slice(4)) || 0), 0);
  return `RFS-${String(max + 1).padStart(4, "0")}`;
}

// ───────────── Writes ─────────────

type EmergencyContactInput = { name: string; relationship: string; phone: string };

function employeeData(input: EmployeeInput) {
  return {
    employeeCode: input.employeeCode.toUpperCase(),
    fullName: input.fullName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    gender: input.gender ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    cnicEnc: input.cnic ? encryptField(input.cnic) : null,
    address: input.address ?? null,
    joiningDate: input.joiningDate,
    employmentType: input.employmentType,
    departmentId: input.departmentId ?? null,
    designationId: input.designationId ?? null,
    shiftId: input.shiftId ?? null,
    managerId: input.managerId ?? null,
    deviceUserId: input.deviceUserId ?? null,
    workMode: input.workMode,
  };
}

/** "+ Add new designation…" on the form: use the existing title or create it, then assign it. */
async function withDesignation(actor: Actor, input: EmployeeInput): Promise<EmployeeInput> {
  if (input.designationId !== NEW_DESIGNATION) return input;
  if (!input.newDesignation) throw new AppError("Enter the new designation title.");
  return { ...input, designationId: await findOrCreateDesignation(actor, input.newDesignation) };
}

function translateUniqueError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = String((err.meta?.target as string[] | undefined)?.join(",") ?? "");
    if (target.includes("employeeCode")) throw new AppError("Another employee already uses this Employee ID.");
    if (target.includes("deviceUserId")) throw new AppError("Another employee already uses this biometric user ID.");
    if (target.includes("email")) throw new AppError("Another employee already uses this email address.");
    throw new AppError("A record with these details already exists.");
  }
  throw err;
}

export async function createEmployee(
  actor: Actor,
  input: EmployeeInput,
  extras: { salary?: Omit<SalaryInput, "effectiveFrom"> | null; bank?: BankInput | null; emergencyContacts: EmergencyContactInput[] },
) {
  assertPermission(actor, "employee.manage", "all");
  if (extras.salary) assertPermission(actor, "salary.manage", "all");
  if (extras.bank) assertPermission(actor, "bank.manage", "all");
  input = await withDesignation(actor, input);

  let created;
  try {
    created = await db.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          ...employeeData(input),
          emergencyContacts: { create: extras.emergencyContacts },
          salaryStructures: extras.salary
            ? {
                create: {
                  effectiveFrom: input.joiningDate,
                  basicSalary: extras.salary.basicSalary,
                  note: extras.salary.note ?? "Initial salary",
                  createdById: actor.userId,
                  allowances: { create: extras.salary.allowances },
                },
              }
            : undefined,
          bankAccount: extras.bank ? { create: bankData(extras.bank) } : undefined,
        },
      });
      await recordAudit(
        { actor, action: "employee.create", entityType: "Employee", entityId: employee.id, after: { ...employee, salary: extras.salary ?? null, bank: extras.bank ? "[set]" : null } },
        tx,
      );
      return employee;
    });
  } catch (err) {
    translateUniqueError(err);
  }
  // Punches imported before this employee existed are attached now.
  if (created.deviceUserId) await relinkEmployeePunches(created.id, created.deviceUserId);
  return created;
}

export async function updateEmployee(actor: Actor, employeeId: string, input: EmployeeInput, emergencyContacts: EmergencyContactInput[]) {
  assertPermission(actor, "employee.manage", "all");
  input = await withDesignation(actor, input);
  const before = await db.employee.findUnique({ where: { id: employeeId }, include: { emergencyContacts: true } });
  if (!before) throw new NotFoundError("Employee not found.");

  if (input.managerId) {
    if (input.managerId === employeeId) throw new AppError("An employee cannot report to themselves.");
    const team = await teamEmployeeIds(employeeId);
    if (team.includes(input.managerId)) throw new AppError("That manager reports to this employee — this would create a reporting loop.");
  }

  let after;
  try {
    after = await db.$transaction(async (tx) => {
      const data = employeeData(input);
      // Keep the existing ciphertext when the CNIC itself has not changed.
      if (before.cnicEnc && input.cnic && decryptField(before.cnicEnc) === input.cnic) data.cnicEnc = before.cnicEnc;
      const after = await tx.employee.update({ where: { id: employeeId }, data });
      await tx.emergencyContact.deleteMany({ where: { employeeId } });
      if (emergencyContacts.length) await tx.emergencyContact.createMany({ data: emergencyContacts.map((c) => ({ ...c, employeeId })) });
      await recordAudit({ actor, action: "employee.update", entityType: "Employee", entityId: employeeId, before, after: { ...after, emergencyContacts } }, tx);
      return after;
    });
  } catch (err) {
    translateUniqueError(err);
  }
  // Biometric ID, shift or employment dates may have changed: re-link punches and recalculate attendance.
  await relinkEmployeePunches(employeeId, after.deviceUserId);
  return after;
}

export async function setEmployeeStatus(actor: Actor, employeeId: string, status: EmploymentStatus, exitDate: Date | null) {
  assertPermission(actor, "employee.manage", "all");
  const before = await db.employee.findUnique({ where: { id: employeeId }, include: { user: { select: { id: true } } } });
  if (!before) throw new NotFoundError("Employee not found.");
  if (actor.employeeId === employeeId && status !== "ACTIVE") throw new AppError("You cannot deactivate your own record.");
  if ((status === "RESIGNED" || status === "TERMINATED") && !exitDate) throw new AppError("Exit date is required.");

  const after = await db.employee.update({
    where: { id: employeeId },
    data: { status, exitDate: status === "ACTIVE" ? null : (exitDate ?? before.exitDate) },
  });
  // A non-active employee must not keep any signed-in session.
  if (status !== "ACTIVE" && before.user) await revokeUserSessions(before.user.id);
  await recordAudit({ actor, action: "employee.status", entityType: "Employee", entityId: employeeId, before: { status: before.status, exitDate: before.exitDate }, after: { status: after.status, exitDate: after.exitDate } });
  return after;
}

/**
 * Permanently delete employees. Removes the profile, login, salary, bank details, emergency contacts and
 * calculated attendance. Raw machine punches are kept (unlinked) and a snapshot is written to the audit log.
 * `confirmation` must be the employee code (single delete) or "DELETE <count>" (bulk) — a guard against mis-clicks.
 */
export async function deleteEmployees(actor: Actor, employeeIds: string[], confirmation: string) {
  assertPermission(actor, "employee.delete", "all");
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) throw new AppError("Select at least one employee.");
  if (ids.length > 200) throw new AppError("Delete at most 200 employees at a time.");
  if (actor.employeeId && ids.includes(actor.employeeId)) throw new AppError("You cannot delete your own employee record.");

  const employees = await db.employee.findMany({
    where: { id: { in: ids } },
    include: {
      department: { select: { name: true } },
      designation: { select: { title: true } },
      user: { select: { id: true, role: { select: { key: true } } } },
      _count: { select: { attendanceDays: true, rawPunches: true, salaryStructures: true } },
    },
  });
  if (employees.length !== ids.length) throw new NotFoundError("Some employees no longer exist. Refresh and try again.");

  const expected = ids.length === 1 ? employees[0]!.employeeCode : `DELETE ${ids.length}`;
  if (confirmation.trim().toUpperCase() !== expected.toUpperCase()) {
    throw new AppError(`Type ${expected} to confirm.`);
  }
  if (employees.some((e) => e.user?.role.key === "SUPER_ADMIN")) {
    throw new AppError("One of these employees has a Super Admin login. Change that login's role first.");
  }

  await db.$transaction(async (tx) => {
    for (const e of employees) {
      await recordAudit(
        {
          actor,
          action: "employee.delete",
          entityType: "Employee",
          entityId: e.id,
          before: {
            employeeCode: e.employeeCode, fullName: e.fullName, email: e.email, department: e.department?.name ?? null,
            designation: e.designation?.title ?? null, joiningDate: e.joiningDate, exitDate: e.exitDate, status: e.status,
            deviceUserId: e.deviceUserId, attendanceDays: e._count.attendanceDays, punchesKept: e._count.rawPunches,
            salaryRevisions: e._count.salaryStructures,
          },
        },
        tx,
      );
      await tx.rawPunch.updateMany({ where: { employeeId: e.id }, data: { employeeId: null } });
      await tx.employee.updateMany({ where: { managerId: e.id }, data: { managerId: null } });
      if (e.user) await tx.user.delete({ where: { id: e.user.id } }); // sessions cascade
      await tx.employee.delete({ where: { id: e.id } }); // salary, bank, contacts, attendance days, documents cascade
    }
  }, { timeout: 60_000 });
  // Document rows cascade with the employee; their files on disk are removed once the delete has committed.
  await removeEmployeeDocumentFiles(employees.map((e) => e.id));
  return { deleted: employees.length };
}

export async function addSalaryStructure(actor: Actor, employeeId: string, input: SalaryInput) {
  assertPermission(actor, "salary.manage", "all");
  const employee = await db.employee.findUnique({ where: { id: employeeId }, select: { joiningDate: true } });
  if (!employee) throw new NotFoundError("Employee not found.");
  if (input.effectiveFrom < employee.joiningDate) throw new AppError("Effective date cannot be before the joining date.");

  try {
    const created = await db.salaryStructure.create({
      data: {
        employeeId,
        effectiveFrom: input.effectiveFrom,
        basicSalary: input.basicSalary,
        note: input.note ?? null,
        createdById: actor.userId,
        allowances: { create: input.allowances },
      },
      include: { allowances: true },
    });
    await recordAudit({ actor, action: "salary.create", entityType: "Employee", entityId: employeeId, after: created });
    return created;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("A salary revision already exists for that effective date.");
    }
    throw err;
  }
}

function bankData(input: BankInput) {
  return {
    bankName: input.bankName,
    branch: input.branch ?? null,
    accountTitle: input.accountTitle,
    accountNumberEnc: encryptField(input.accountNumber),
    ibanEnc: input.iban ? encryptField(input.iban) : null,
  };
}

export async function upsertBankAccount(actor: Actor, employeeId: string, input: BankInput) {
  assertPermission(actor, "bank.manage", "all");
  const exists = await db.employee.count({ where: { id: employeeId } });
  if (!exists) throw new NotFoundError("Employee not found.");
  const data = bankData(input);
  await db.bankAccount.upsert({ where: { employeeId }, create: { employeeId, ...data }, update: data });
  await recordAudit({ actor, action: "bank.update", entityType: "Employee", entityId: employeeId, after: { bankName: input.bankName, accountTitle: input.accountTitle } });
}

/** Self-service: an employee may update only their contact details and emergency contacts. */
export async function updateOwnProfile(
  actor: Actor,
  input: { phone?: string; address?: string; emergencyContacts: EmergencyContactInput[] },
) {
  assertPermission(actor, "profile.update", "self");
  if (!actor.employeeId) throw new AppError("Your account is not linked to an employee record.");
  const employeeId = actor.employeeId;
  const before = await db.employee.findUnique({ where: { id: employeeId }, select: { phone: true, address: true, emergencyContacts: true } });

  await db.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data: { phone: input.phone ?? null, address: input.address ?? null } });
    await tx.emergencyContact.deleteMany({ where: { employeeId } });
    if (input.emergencyContacts.length) await tx.emergencyContact.createMany({ data: input.emergencyContacts.map((c) => ({ ...c, employeeId })) });
    await recordAudit({ actor, action: "profile.self_update", entityType: "Employee", entityId: employeeId, before, after: input }, tx);
  });
}
