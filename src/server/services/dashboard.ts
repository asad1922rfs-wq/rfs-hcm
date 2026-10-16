import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { can, type Actor } from "@/server/auth/session";
import { scopedEmployeeWhere } from "@/server/auth/scope";
import { addDays, nextAnniversary, todayInPKT, toDateOnlyString, yearsBetween } from "@/lib/dates";
import { ruleForDate } from "@/core/attendance/engine";

export async function getDashboardData(actor: Actor) {
  const scope = await scopedEmployeeWhere(actor, "employee.read");
  const active: Prisma.EmployeeWhereInput = { AND: [scope, { status: "ACTIVE" }] };
  const today = todayInPKT();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const [totalActive, inactive, newThisMonth, byDepartment, byType, people] = await Promise.all([
    db.employee.count({ where: active }),
    db.employee.count({ where: { AND: [scope, { status: { not: "ACTIVE" } }] } }),
    db.employee.count({ where: { AND: [active, { joiningDate: { gte: monthStart } }] } }),
    db.employee.groupBy({ by: ["departmentId"], where: active, _count: { _all: true } }),
    db.employee.groupBy({ by: ["employmentType"], where: active, _count: { _all: true } }),
    db.employee.findMany({
      where: active,
      select: { id: true, fullName: true, employeeCode: true, photoPath: true, dateOfBirth: true, joiningDate: true, department: { select: { name: true } } },
    }),
  ]);

  const departments = await db.department.findMany({ select: { id: true, name: true } });
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const headcountByDepartment = byDepartment
    .map((r) => ({ name: r.departmentId ? (deptName.get(r.departmentId) ?? "Unknown") : "Unassigned", count: r._count._all }))
    .sort((a, b) => b.count - a.count);

  const birthdaysToday = people.filter(
    (p) => p.dateOfBirth && p.dateOfBirth.getUTCMonth() === today.getUTCMonth() && nextAnniversary(p.dateOfBirth, today).getTime() === today.getTime(),
  );

  const horizon = addDays(today, 30);
  const anniversaries = people
    .map((p) => {
      const next = nextAnniversary(p.joiningDate, today);
      return { ...p, date: next, years: yearsBetween(p.joiningDate, next) };
    })
    .filter((p) => p.years >= 1 && p.date <= horizon)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 8);

  // Estimated monthly payroll = sum of salaries in force today. Only for people allowed to see all salaries.
  let estimatedPayroll: string | null = null;
  if (can(actor, "salary.read", "all")) {
    // Latest salary in force per active employee (portable across MySQL/MariaDB — no LATERAL joins).
    const structures = await db.salaryStructure.findMany({
      where: { effectiveFrom: { lte: today }, employee: { status: "ACTIVE" } },
      orderBy: { effectiveFrom: "desc" },
      select: { employeeId: true, basicSalary: true, allowances: { select: { amount: true } } },
    });
    const seen = new Set<string>();
    let total = new Prisma.Decimal(0);
    for (const s of structures) {
      if (seen.has(s.employeeId)) continue;
      seen.add(s.employeeId);
      total = total.add(s.basicSalary).add(s.allowances.reduce((sum, a) => sum.add(a.amount), new Prisma.Decimal(0)));
    }
    estimatedPayroll = total.toString();
  }

  // Today's attendance from processed punches. Absence is only known after the shift, so before that
  // anyone without a punch counts as "not checked in".
  const todayRows = await db.attendanceDay.groupBy({
    by: ["status"],
    where: { workDate: today, employee: active },
    _count: { _all: true },
  });
  const countOf = (...statuses: string[]) => todayRows.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + r._count._all, 0);
  const lastPunch = await db.rawPunch.findFirst({ orderBy: { punchedAt: "desc" }, select: { punchedAt: true } });
  const checkedIn = countOf("PRESENT", "LATE", "EARLY", "MISSING", "HALF_DAY", "SHORT_DAY");
  const attendanceToday = lastPunch
    ? {
        present: checkedIn,
        late: countOf("LATE"),
        absent: countOf("ABSENT"),
        onLeave: countOf("LEAVE"),
        notCheckedIn: Math.max(0, totalActive - checkedIn - countOf("ABSENT", "LEAVE")),
        lastPunchAt: lastPunch.punchedAt,
      }
    : null;

  const defaultShift = await db.shift.findFirst({ where: { isDefault: true, isActive: true }, include: { dayOverrides: true } });
  const shiftToday = defaultShift ? ruleForDate({ ...defaultShift, overrides: defaultShift.dayOverrides }, toDateOnlyString(today)) : null;

  return {
    today,
    shiftStartToday: shiftToday?.startMinute ?? null,
    attendanceToday,
    totalActive,
    inactive,
    newThisMonth,
    headcountByDepartment,
    byEmploymentType: byType.map((r) => ({ name: r.employmentType, count: r._count._all })),
    birthdaysToday,
    anniversaries,
    estimatedPayroll,
  };
}
