import { describe, expect, it } from "vitest";
import { normaliseCnic, normalisePhone, parseFlexibleDate, parseFlowHcmRows } from "@/core/employees/flowhcm-import";

// Synthetic rows mirroring the FlowHCM template's quirks (no real employee data).
const HEADER = [
  "EmployeeCode", "PunchCode", "FirstName", "LastName", "FatherName", "MobileNo", "Email", "EmployeeReportsTo",
  "AllowEmployeeLogin", "Password", "MaritalStatus", "Gender", "DateOfBirth", "EmiratesID/CnicNo", "Address", "City",
  "AccountNo", "AccountTitle", "Bank", "BranchCode", "EmergencyContactPerson", "RelationShip", "RelativeMobileNo",
  "Department", "Designation", "Grade", "EmployeeStatus", "JoiningDate", "ResignDate", "LeavingDate", "Status",
];
const TODAY = new Date("2026-10-16T00:00:00Z");
const row = (o: Partial<Record<(typeof HEADER)[number], string>>) => HEADER.map((h) => o[h] ?? "");
const base = { EmployeeCode: "200", PunchCode: "200", FirstName: "Test", LastName: "Person", JoiningDate: "01-Mar-24", Status: "Active", EmployeeStatus: "Permanent" };

describe("parseFlexibleDate", () => {
  it("handles FlowHCM two-digit years", () => {
    expect(parseFlexibleDate("21-Sep-26", TODAY)).toBe("2026-09-21");
    expect(parseFlexibleDate("09-Sep-92", TODAY)).toBe("1992-09-09");
    expect(parseFlexibleDate("16-Jun-02", TODAY)).toBe("2002-06-16");
    expect(parseFlexibleDate("2026-09-21", TODAY)).toBe("2026-09-21");
    expect(parseFlexibleDate("31/12/2001", TODAY)).toBe("2001-12-31");
    expect(parseFlexibleDate("31-Feb-24", TODAY)).toBeNull();
    expect(parseFlexibleDate("--", TODAY)).toBeNull();
  });
});

describe("normalisers", () => {
  it("restores the leading zero Excel drops and accepts +92", () => {
    expect(normalisePhone("3001234567")).toBe("03001234567");
    expect(normalisePhone("+923001234567")).toBe("03001234567");
    expect(normalisePhone("0300-1234567")).toBe("03001234567");
    expect(normalisePhone("abc")).toBeNull();
  });
  it("formats CNIC with or without dashes", () => {
    expect(normaliseCnic("4220112345671")).toBe("42201-1234567-1");
    expect(normaliseCnic("42201-1234567-1")).toBe("42201-1234567-1");
    expect(normaliseCnic("12345")).toBeNull();
  });
});

describe("parseFlowHcmRows", () => {
  it("maps a clean row", () => {
    const [r] = parseFlowHcmRows(HEADER, [row({ ...base, Gender: "Male", Department: "Team  Waqar", Designation: "Web Developer", EmployeeStatus: "Probation", Email: "T@Example.com" })], TODAY);
    expect(r).toMatchObject({
      employeeCode: "200", deviceUserId: "200", fullName: "Test Person", gender: "MALE", department: "Team Waqar",
      employmentType: "PROBATION", status: "ACTIVE", joiningDate: "2024-03-01", email: "t@example.com",
    });
    expect(r!.errors).toEqual([]);
  });

  it("never reads the Password column", () => {
    const [r] = parseFlowHcmRows(HEADER, [row({ ...base, Password: "12345" })], TODAY);
    expect(JSON.stringify(r)).not.toContain("12345");
  });

  it("drops impossible birth dates with a warning", () => {
    const [r] = parseFlowHcmRows(HEADER, [row({ ...base, DateOfBirth: "05-Oct-23" })], TODAY);
    expect(r!.dateOfBirth).toBeNull();
    expect(r!.warnings.join()).toMatch(/age 3/);
  });

  it("treats a resign date on an 'Active' row as resigned, and says so", () => {
    const [r] = parseFlowHcmRows(HEADER, [row({ ...base, ResignDate: "01-Aug-26" })], TODAY);
    expect(r).toMatchObject({ status: "RESIGNED", exitDate: "2026-08-01" });
    expect(r!.warnings.join()).toMatch(/Resigned/);
  });

  it("splits multi-person emergency contacts", () => {
    const [r] = parseFlowHcmRows(
      HEADER,
      [row({ ...base, EmergencyContactPerson: "Faiza / Asghar", RelationShip: "Wife & Brother", RelativeMobileNo: "03001111111 & 03002222222" })],
      TODAY,
    );
    expect(r!.emergencyContacts).toEqual([
      { name: "Faiza", relationship: "Wife", phone: "03001111111" },
      { name: "Asghar", relationship: "Brother", phone: "03002222222" },
    ]);
  });

  it("recognises an IBAN in the account number column", () => {
    const [r] = parseFlowHcmRows(HEADER, [row({ ...base, AccountNo: "PK36SCBL0000001123456702", Bank: "SCB", AccountTitle: "Test Person" })], TODAY);
    expect(r!.bank).toMatchObject({ bankName: "SCB", iban: "PK36SCBL0000001123456702" });
  });

  it("skips rows with no code or joining date, and flags duplicate codes", () => {
    const rows = parseFlowHcmRows(
      HEADER,
      [row({ ...base }), row({ ...base, PunchCode: "201" }), row({ ...base, EmployeeCode: "", PunchCode: "202" }), row({ ...base, EmployeeCode: "203", PunchCode: "203", JoiningDate: "" })],
      TODAY,
    );
    expect(rows[1]!.errors.join()).toMatch(/duplicates row/);
    expect(rows[2]!.errors.join()).toMatch(/code is missing/);
    expect(rows[3]!.errors.join()).toMatch(/Joining date/);
  });

  it("drops self-reporting managers", () => {
    const [r] = parseFlowHcmRows(HEADER, [row({ ...base, EmployeeReportsTo: "200" })], TODAY);
    expect(r!.reportsToCode).toBeNull();
  });
});
