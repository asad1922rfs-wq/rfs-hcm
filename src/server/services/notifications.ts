import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/auth/session";
import { pendingAttendanceRequestCount } from "@/server/services/attendance-requests";
import { pendingLeaveCount } from "@/server/services/leave";
import { ownLoanCount, pendingLoanCount } from "@/server/services/loans";
import { formatDate } from "@/lib/format";

/** How far back the employee is told about their own decided requests. */
const DECIDED_DAYS = 7;
const MAX_DECIDED = 10;

export type PendingGroup = { key: "attendance" | "leave" | "loans"; label: string; count: number; href: string };
export type DecidedItem = { id: string; text: string; approved: boolean; href: string; decidedAt: Date };
export type Notifications = {
  pending: PendingGroup[];
  decided: DecidedItem[];
  /** Badge total: pending approvals plus recent outcomes. */
  total: number;
  /** Pending approvals per sidebar link. */
  navBadges: Record<string, number>;
  /** The actor has a pending, running or completed loan of their own (self-only users see Loans only then). */
  hasOwnLoans: boolean;
};

/** What the signed-in user should know about: requests waiting for them, and outcomes of their own recent requests. */
export async function notificationsFor(actor: Actor): Promise<Notifications> {
  const since = new Date(Date.now() - DECIDED_DAYS * 24 * 60 * 60 * 1000);
  const decidedWhere = actor.employeeId
    ? { employeeId: actor.employeeId, status: { in: ["APPROVED", "REJECTED"] as ("APPROVED" | "REJECTED")[] }, decidedAt: { gte: since } }
    : null;

  const [attendance, leave, loans, myAttendance, myLeave, ownLoans] = await Promise.all([
    pendingAttendanceRequestCount(actor),
    pendingLeaveCount(actor),
    pendingLoanCount(actor),
    decidedWhere
      ? db.attendanceRequest.findMany({ where: decidedWhere, select: { id: true, workDate: true, status: true, decidedAt: true }, orderBy: { decidedAt: "desc" }, take: MAX_DECIDED })
      : Promise.resolve([]),
    decidedWhere
      ? db.leaveRequest.findMany({
          where: decidedWhere,
          select: { id: true, startDate: true, endDate: true, status: true, decidedAt: true, leaveType: { select: { name: true } } },
          orderBy: { decidedAt: "desc" },
          take: MAX_DECIDED,
        })
      : Promise.resolve([]),
    actor.employeeId ? ownLoanCount(actor.employeeId) : Promise.resolve(0),
  ]);

  const pending: PendingGroup[] = (
    [
      { key: "attendance", label: "Attendance requests waiting for approval", count: attendance, href: "/attendance/requests?view=approvals" },
      { key: "leave", label: "Leave requests waiting for approval", count: leave, href: "/leave?view=approvals" },
      { key: "loans", label: "Loan requests", count: loans, href: "/loans?view=pending" },
    ] satisfies PendingGroup[]
  ).filter((g) => g.count > 0);

  const word = (s: string) => (s === "APPROVED" ? "approved" : "rejected");
  const decided: DecidedItem[] = [
    ...myAttendance.map((r) => ({
      id: `att-${r.id}`, approved: r.status === "APPROVED", href: "/attendance/requests", decidedAt: r.decidedAt!,
      text: `Your attendance request for ${formatDate(r.workDate)} was ${word(r.status)}`,
    })),
    ...myLeave.map((r) => ({
      id: `leave-${r.id}`, approved: r.status === "APPROVED", href: "/leave", decidedAt: r.decidedAt!,
      text: `Your ${r.leaveType.name} request for ${formatDate(r.startDate)}${r.endDate.getTime() !== r.startDate.getTime() ? ` – ${formatDate(r.endDate)}` : ""} was ${word(r.status)}`,
    })),
  ].sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime()).slice(0, MAX_DECIDED);

  return {
    pending,
    decided,
    total: pending.reduce((s, g) => s + g.count, 0) + decided.length,
    navBadges: { "/attendance/requests": attendance, "/leave": leave, "/loans": loans },
    hasOwnLoans: ownLoans > 0,
  };
}
