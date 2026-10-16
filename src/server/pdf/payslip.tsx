import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { rupeesInWords } from "@/core/payroll/amount-in-words";

// A4 payslip. Built-in Helvetica keeps the PDF small and dependency-free.

export type PayslipData = {
  company: { legalName: string; address: string | null; phone: string | null; email: string | null; ntn: string | null; logo?: string | null };
  period: string; // "October 2026"
  status: "APPROVED" | "PAID";
  paidAt: Date | null;
  generatedAt: Date;
  employee: { code: string; name: string; department: string | null; designation: string | null; cnicMasked: string | null; bank: string | null };
  attendance: { daysInMonth: number; employedDays: number; presentDays: number; absentDays: number; lateCount: number; missingPunchCount: number; lateDeductionDays: number };
  perDayRate: number;
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
};

const NAVY = "#1e3a8a";
const GREY = "#64748b";
const LINE = "#e2e8f0";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, fontFamily: "Helvetica", color: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 10, marginBottom: 14 },
  company: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
  muted: { color: GREY },
  title: { fontSize: 12, fontFamily: "Helvetica-Bold", textAlign: "right" },
  status: { marginTop: 4, alignSelf: "flex-end", paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  grid: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8, marginBottom: 12 },
  cell: { width: "33.33%", paddingVertical: 3 },
  label: { fontSize: 7.5, color: GREY, textTransform: "uppercase" },
  value: { marginTop: 1 },
  columns: { flexDirection: "row", gap: 12, marginBottom: 12 },
  column: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4 },
  colHead: { backgroundColor: NAVY, color: "#ffffff", fontFamily: "Helvetica-Bold", padding: 6, flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6, paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: LINE },
  rowLabel: { flex: 1, paddingRight: 6 },
  total: { flexDirection: "row", justifyContent: "space-between", padding: 6, fontFamily: "Helvetica-Bold" },
  net: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#eff6ff", borderWidth: 1, borderColor: NAVY, borderRadius: 4, padding: 10 },
  netAmount: { fontSize: 16, fontFamily: "Helvetica-Bold", color: NAVY },
  footer: { position: "absolute", bottom: 28, left: 36, right: 36, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, fontSize: 7.5, color: GREY, flexDirection: "row", justifyContent: "space-between" },
});

const pkr = (n: number) => `Rs ${Math.round(n).toLocaleString("en-PK")}`;
const pkr2 = (n: number) => `Rs ${n.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** The built-in PDF font (WinAnsi) has no arrow glyph. */
const pdfText = (t: string) => t.replace(/→/g, "=");
const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" }).format(d);

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <View style={s.cell}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value ?? "—"}</Text>
    </View>
  );
}

function Lines({ title, lines, total }: { title: string; lines: { label: string; amount: number }[]; total: number }) {
  return (
    <View style={s.column}>
      <View style={s.colHead}><Text>{title}</Text><Text>Amount</Text></View>
      {lines.length === 0 && <View style={s.row}><Text style={s.muted}>None</Text></View>}
      {lines.map((l, i) => (
        <View key={i} style={s.row} wrap={false}>
          <Text style={s.rowLabel}>{pdfText(l.label)}</Text>
          <Text>{pkr(l.amount)}</Text>
        </View>
      ))}
      <View style={s.total}><Text>Total {title.toLowerCase()}</Text><Text>{pkr(total)}</Text></View>
    </View>
  );
}

function PayslipPage({ d }: { d: PayslipData }) {
  const contact = [d.company.address, d.company.phone, d.company.email].filter(Boolean).join(" · ");
  return (
    <Page size="A4" style={s.page}>
      <View style={s.header}>
        <View style={{ maxWidth: "65%", flexDirection: "row", gap: 10 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          {d.company.logo ? <Image src={d.company.logo} style={{ width: 42, height: 42, objectFit: "contain" }} /> : null}
          <View>
          <Text style={s.company}>{d.company.legalName}</Text>
          {contact ? <Text style={[s.muted, { marginTop: 3 }]}>{contact}</Text> : null}
          {d.company.ntn ? <Text style={s.muted}>NTN: {d.company.ntn}</Text> : null}
          </View>
        </View>
        <View>
          <Text style={s.title}>Payslip</Text>
          <Text style={{ textAlign: "right", marginTop: 2 }}>{d.period}</Text>
          <Text style={[s.status, { backgroundColor: d.status === "PAID" ? "#15803d" : NAVY }]}>{d.status === "PAID" ? "PAID" : "APPROVED"}</Text>
        </View>
      </View>

      <View style={s.grid}>
        <Field label="Employee" value={d.employee.name} />
        <Field label="Employee ID" value={d.employee.code} />
        <Field label="Department" value={d.employee.department} />
        <Field label="Designation" value={d.employee.designation} />
        <Field label="CNIC" value={d.employee.cnicMasked} />
        <Field label="Bank account" value={d.employee.bank} />
      </View>

      <View style={s.grid}>
        <Field label="Days in month" value={d.attendance.daysInMonth} />
        <Field label="Days employed" value={d.attendance.employedDays} />
        <Field label="Per-day rate" value={pkr2(d.perDayRate)} />
        <Field label="Present" value={d.attendance.presentDays} />
        <Field label="Absent" value={d.attendance.absentDays} />
        <Field label="Late + missing punch" value={`${d.attendance.lateCount} + ${d.attendance.missingPunchCount} = ${d.attendance.lateDeductionDays} day(s) deducted`} />
      </View>

      <View style={s.columns}>
        <Lines title="Earnings" lines={d.earnings} total={d.totalEarnings} />
        <Lines title="Deductions" lines={d.deductions} total={d.totalDeductions} />
      </View>

      <View style={s.net} wrap={false}>
        <View>
          <Text style={s.label}>Net salary</Text>
          <Text style={{ marginTop: 3 }}>{rupeesInWords(d.netPay)}</Text>
        </View>
        <Text style={s.netAmount}>{pkr(d.netPay)}</Text>
      </View>

      <View style={s.footer} fixed>
        <Text>Computer-generated payslip — no signature required.</Text>
        <Text>
          Generated {fmtDate(d.generatedAt)}{d.paidAt ? ` · Paid ${fmtDate(d.paidAt)}` : ""}
        </Text>
      </View>
    </Page>
  );
}

export async function renderPayslips(payslips: PayslipData[]): Promise<Buffer> {
  return renderToBuffer(
    <Document title={payslips.length === 1 ? `Payslip ${payslips[0]!.period} ${payslips[0]!.employee.code}` : `Payslips ${payslips[0]?.period ?? ""}`} author="RFS HCM">
      {payslips.map((p, i) => <PayslipPage key={i} d={p} />)}
    </Document>,
  );
}
