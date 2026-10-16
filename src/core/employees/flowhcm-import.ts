// Parses the FlowHCM "EmployeeTemplate" export into clean employee records. Pure: input is a header row plus
// data rows of cell text. Problems are reported per row instead of guessed silently:
//   errors   → the row is skipped
//   warnings → the row is imported, the questionable value is dropped or flagged for HR to review
// The template's Password column is never read: those passwords are plain text and must be treated as exposed.

export type ImportedEmergencyContact = { name: string; relationship: string; phone: string };
export type ImportedBank = { bankName: string; accountTitle: string; accountNumber: string; branch: string | null; iban: string | null };

export type ImportRow = {
  rowNumber: number;
  employeeCode: string;
  deviceUserId: string | null;
  fullName: string;
  fatherName: string | null;
  email: string | null;
  phone: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  maritalStatus: string | null;
  dateOfBirth: string | null; // YYYY-MM-DD
  cnic: string | null; // 12345-1234567-1
  address: string | null;
  department: string | null;
  designation: string | null;
  grade: string | null;
  employmentType: "PERMANENT" | "PROBATION" | "CONTRACT" | "INTERN" | "PART_TIME";
  status: "ACTIVE" | "INACTIVE" | "RESIGNED" | "TERMINATED";
  joiningDate: string | null;
  exitDate: string | null;
  reportsToCode: string | null;
  allowLogin: boolean;
  emergencyContacts: ImportedEmergencyContact[];
  bank: ImportedBank | null;
  warnings: string[];
  errors: string[];
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "", "--", "-", "N/A" → null; collapses repeated spaces. */
export function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s === "" || /^(-+|n\/?a|null|none)$/i.test(s) ? null : s;
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Dates as FlowHCM exports them: "21-Sep-26", "09-Sep-92", plus ISO and day-first numeric forms.
 * Two-digit years: up to (current year + 1) → 20xx, otherwise 19xx.
 */
export function parseFlexibleDate(value: string | null, today: Date = new Date()): string | null {
  const v = clean(value);
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2}|\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (!month) return null;
    let year = +m[3]!;
    if (m[3]!.length === 2) year += year <= (today.getUTCFullYear() % 100) + 1 ? 2000 : 1900;
    return iso(year, month, +m[1]!);
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  return null;
}

export function normalisePhone(value: string | null): string | null {
  const v = clean(value);
  if (!v) return null;
  let digits = v.replace(/[^\d+]/g, "");
  if (/^3\d{9}$/.test(digits)) digits = `0${digits}`; // Excel drops the leading zero
  if (/^\+?92(3\d{9})$/.test(digits)) digits = `0${digits.replace(/^\+?92/, "")}`;
  return /^\+?\d{7,15}$/.test(digits) ? digits : null;
}

export function normaliseCnic(value: string | null): string | null {
  const digits = (clean(value) ?? "").replace(/\D/g, "");
  return digits.length === 13 ? `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}` : null;
}

const splitMulti = (v: string | null) => (v ? v.split(/\s*(?:\/|&|,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean) : []);

function employmentTypeOf(v: string | null): ImportRow["employmentType"] | null {
  const s = (v ?? "").toLowerCase();
  if (!s) return "PERMANENT";
  if (s.startsWith("perm") || s.startsWith("confirm") || s === "regular") return "PERMANENT";
  if (s.startsWith("prob")) return "PROBATION";
  if (s.startsWith("intern")) return "INTERN";
  if (s.startsWith("contract")) return "CONTRACT";
  if (s.includes("part")) return "PART_TIME";
  return null;
}

/** Append the city unless the address already mentions it. */
function withCity(address: string | null, city: string | null): string | null {
  if (!address) return null;
  return city && !address.toLowerCase().includes(city.toLowerCase()) ? `${address}, ${city}` : address;
}

function ageOn(dob: string, today: Date): number {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age;
}

export function parseFlowHcmRows(header: string[], rows: string[][], today: Date = new Date()): ImportRow[] {
  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const get = (row: string[], name: string) => {
    const i = col.get(name.toLowerCase());
    return i === undefined ? null : clean(row[i]);
  };

  const out: ImportRow[] = [];
  rows.forEach((row, idx) => {
    if (row.every((c) => !clean(c))) return; // blank line
    const warnings: string[] = [];
    const errors: string[] = [];

    const employeeCode = (get(row, "EmployeeCode") ?? "").toUpperCase();
    if (!employeeCode) errors.push("Employee code is missing");
    else if (!/^[A-Z0-9_-]{1,20}$/.test(employeeCode)) errors.push(`Employee code "${employeeCode}" has unsupported characters`);

    const fullName = [get(row, "FirstName"), get(row, "LastName")].filter(Boolean).join(" ");
    if (fullName.length < 2) errors.push("Name is missing");

    const punch = get(row, "PunchCode");
    const deviceUserId = punch && /^[0-9A-Za-z]{1,20}$/.test(punch) ? punch.replace(/^0+(?=\d)/, "") : null;
    if (punch && !deviceUserId) warnings.push(`Punch code "${punch}" is not valid — not linked to the machine`);
    if (!punch) warnings.push("No punch code — attendance will not link to the machine");

    const joiningDate = parseFlexibleDate(get(row, "JoiningDate"), today);
    if (!joiningDate) errors.push("Joining date is missing or not a valid date");

    let dateOfBirth = parseFlexibleDate(get(row, "DateOfBirth"), today);
    if (get(row, "DateOfBirth") && !dateOfBirth) warnings.push("Date of birth not understood — left empty");
    if (dateOfBirth) {
      const age = ageOn(dateOfBirth, today);
      if (age < 16 || age > 80) {
        warnings.push(`Date of birth ${get(row, "DateOfBirth")} gives age ${age} — left empty, please correct`);
        dateOfBirth = null;
      }
    }

    const rawEmail = get(row, "Email")?.toLowerCase() ?? null;
    const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;
    if (rawEmail && !email) warnings.push(`Email "${rawEmail}" is not valid — left empty`);

    const rawPhone = get(row, "MobileNo");
    const phone = normalisePhone(splitMulti(rawPhone)[0] ?? rawPhone);
    if (rawPhone && !phone) warnings.push(`Mobile "${rawPhone}" is not a valid number — left empty`);

    const rawCnic = get(row, "EmiratesID/CnicNo");
    const cnic = normaliseCnic(rawCnic);
    if (rawCnic && !cnic) warnings.push("CNIC is not 13 digits — left empty");

    const genderRaw = (get(row, "Gender") ?? "").toLowerCase();
    const gender = genderRaw.startsWith("m") ? "MALE" : genderRaw.startsWith("f") ? "FEMALE" : genderRaw ? "OTHER" : null;

    const typeRaw = get(row, "EmployeeStatus");
    let employmentType = employmentTypeOf(typeRaw);
    if (!employmentType) {
      warnings.push(`Employment status "${typeRaw}" not recognised — set to Permanent`);
      employmentType = "PERMANENT";
    }

    const leaving = parseFlexibleDate(get(row, "LeavingDate"), today);
    const resign = parseFlexibleDate(get(row, "ResignDate"), today);
    const statusRaw = (get(row, "Status") ?? "Active").toLowerCase();
    let status: ImportRow["status"] = statusRaw.startsWith("inact") ? "INACTIVE" : statusRaw.startsWith("term") ? "TERMINATED" : statusRaw.startsWith("resign") ? "RESIGNED" : "ACTIVE";
    let exitDate: string | null = null;
    if (leaving || resign) {
      exitDate = leaving ?? resign;
      if (status === "ACTIVE") {
        warnings.push(`Status says Active but a ${leaving ? "leaving" : "resign"} date (${exitDate}) is set — imported as Resigned`);
        status = "RESIGNED";
      }
    }

    const names = splitMulti(get(row, "EmergencyContactPerson"));
    const relations = splitMulti(get(row, "RelationShip"));
    const phones = splitMulti(get(row, "RelativeMobileNo")).map(normalisePhone);
    const emergencyContacts: ImportedEmergencyContact[] = [];
    names.forEach((name, i) => {
      const p = phones[i] ?? (names.length === 1 ? phones[0] : null);
      if (p) emergencyContacts.push({ name, relationship: relations[i] ?? relations[0] ?? "Contact", phone: p });
    });
    if (names.length && emergencyContacts.length < names.length) warnings.push("Emergency contact phone missing or invalid for some contacts");

    const accountNo = get(row, "AccountNo")?.replace(/\s+/g, "") ?? null;
    let bank: ImportedBank | null = null;
    if (accountNo) {
      const isIban = /^PK\d{2}[A-Z]{4}\d{16}$/i.test(accountNo);
      const bankName = get(row, "Bank");
      if (!bankName) warnings.push("Bank account given without bank name — bank name set to “Unknown”");
      bank = {
        bankName: bankName ?? "Unknown",
        accountTitle: get(row, "AccountTitle") ?? fullName,
        accountNumber: accountNo.toUpperCase(),
        branch: get(row, "BranchCode"),
        iban: isIban ? accountNo.toUpperCase() : null,
      };
    }

    out.push({
      rowNumber: idx + 2,
      employeeCode,
      deviceUserId,
      fullName,
      fatherName: get(row, "FatherName"),
      email,
      phone,
      gender,
      maritalStatus: get(row, "MaritalStatus"),
      dateOfBirth,
      cnic,
      address: withCity(get(row, "Address"), get(row, "City")),
      department: get(row, "Department"),
      designation: get(row, "Designation"),
      grade: get(row, "Grade"),
      employmentType,
      status,
      joiningDate,
      exitDate,
      reportsToCode: get(row, "EmployeeReportsTo")?.toUpperCase() ?? null,
      allowLogin: /^y/i.test(get(row, "AllowEmployeeLogin") ?? ""),
      emergencyContacts,
      bank,
      warnings,
      errors,
    });
  });

  // Duplicates within the file
  const seen = { code: new Map<string, number>(), punch: new Map<string, number>(), email: new Map<string, number>() };
  for (const r of out) {
    if (r.employeeCode && seen.code.has(r.employeeCode)) r.errors.push(`Employee code duplicates row ${seen.code.get(r.employeeCode)}`);
    else seen.code.set(r.employeeCode, r.rowNumber);
    if (r.deviceUserId && seen.punch.has(r.deviceUserId)) {
      r.warnings.push(`Punch code duplicates row ${seen.punch.get(r.deviceUserId)} — not linked`);
      r.deviceUserId = null;
    } else if (r.deviceUserId) seen.punch.set(r.deviceUserId, r.rowNumber);
    if (r.email && seen.email.has(r.email)) {
      r.warnings.push(`Email duplicates row ${seen.email.get(r.email)} — left empty`);
      r.email = null;
    } else if (r.email) seen.email.set(r.email, r.rowNumber);
  }

  // Reporting manager must exist in the file (or already in the system — checked at import time)
  const codes = new Set(out.map((r) => r.employeeCode));
  const byPunch = new Map(out.filter((r) => r.deviceUserId).map((r) => [r.deviceUserId!, r.employeeCode]));
  for (const r of out) {
    if (!r.reportsToCode) continue;
    if (r.reportsToCode === r.employeeCode) {
      r.warnings.push("Reports to themselves — manager left empty");
      r.reportsToCode = null;
    } else if (!codes.has(r.reportsToCode) && byPunch.has(r.reportsToCode)) {
      r.reportsToCode = byPunch.get(r.reportsToCode)!;
    }
  }
  return out;
}
