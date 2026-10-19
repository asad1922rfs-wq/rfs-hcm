// Who may take which leave type. Pure. Client rule: no leave during probation — only permanent employees avail
// the leave types flagged "permanent only" (Annual, Sick). Types without the flag (e.g. unpaid) are open to everyone.

export type EmploymentType = "PERMANENT" | "PROBATION" | "CONTRACT" | "INTERN" | "PART_TIME";

export type LeaveEligibility = { eligible: true; reason: null } | { eligible: false; reason: string };

/** How the employment type reads after "is …", e.g. "Abdul Rafay is on probation". */
const STATUS_PHRASE: Record<EmploymentType, string> = {
  PERMANENT: "permanent",
  PROBATION: "on probation",
  CONTRACT: "on contract",
  INTERN: "an intern",
  PART_TIME: "part-time",
};

/** Short label for balance rows, e.g. "Not eligible (probation)". */
const STATUS_SHORT: Record<EmploymentType, string> = {
  PERMANENT: "permanent",
  PROBATION: "probation",
  CONTRACT: "contract",
  INTERN: "intern",
  PART_TIME: "part-time",
};

export function leaveEligibility(employmentType: EmploymentType, leaveType: { permanentOnly: boolean }): LeaveEligibility {
  if (!leaveType.permanentOnly || employmentType === "PERMANENT") return { eligible: true, reason: null };
  return { eligible: false, reason: `Not eligible (${STATUS_SHORT[employmentType]})` };
}

/** Error text for a request or approval that breaks the rule, e.g. "Annual Leave is only for permanent employees (Abdul Rafay is on probation)." */
export function ineligibleLeaveMessage(leaveTypeName: string, employeeName: string, employmentType: EmploymentType): string {
  return `${leaveTypeName} is only for permanent employees (${employeeName} is ${STATUS_PHRASE[employmentType]}).`;
}
