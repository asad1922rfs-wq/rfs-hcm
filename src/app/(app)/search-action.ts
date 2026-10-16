"use server";

import { getActor, can } from "@/server/auth/session";
import { scopedEmployeeWhere } from "@/server/auth/scope";
import { db } from "@/server/db";

export type SearchResult = { kind: "employee" | "page"; title: string; subtitle: string; href: string };

/** Global search: employees the viewer may see (name, ID, email, phone) plus app pages. */
export async function globalSearchAction(query: string): Promise<SearchResult[]> {
  const actor = await getActor();
  const q = query.trim().slice(0, 60);
  if (!actor || q.length < 2) return [];

  const results: SearchResult[] = [];
  if (can(actor, "employee.read", "team")) {
    const scope = await scopedEmployeeWhere(actor, "employee.read");
    const employees = await db.employee.findMany({
      where: {
        AND: [
          scope,
          {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { employeeCode: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { deviceUserId: { equals: q } },
            ],
          },
        ],
      },
      orderBy: [{ status: "asc" }, { fullName: "asc" }],
      take: 8,
      select: { id: true, fullName: true, employeeCode: true, status: true, department: { select: { name: true } }, designation: { select: { title: true } } },
    });
    for (const e of employees) {
      results.push({
        kind: "employee",
        title: e.fullName,
        subtitle: [e.employeeCode, e.designation?.title, e.department?.name, e.status !== "ACTIVE" ? e.status.toLowerCase() : null].filter(Boolean).join(" · "),
        href: `/employees/${e.id}`,
      });
    }
  }
  return results;
}
