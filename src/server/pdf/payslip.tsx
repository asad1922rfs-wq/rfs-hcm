import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { rupeesInWords } from "@/core/payroll/amount-in-words";

// A4 payslip in the layout RFS used in FlowHCM. Built-in Helvetica keeps the PDF small and dependency-free.
// One layout, two variants: "expected" (an estimate before payroll is approved) and "final" (approved / paid run).

export type PayslipData = {
  kind: "expected" | "final";
  company: { legalName: string; address: string | null; phone: string | null; email: string | null; ntn: string | null; logo?: string | null };
  period: string; // "October 2026"
  status: "ESTIMATE" | "APPROVED" | "PAID";
  paidAt: Date | null;
  printDate: Date;
  /** Who printed it: the signed-in user's employee name, else their email. */
  printedBy: string;
  employee: {
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    /** Full or masked, already decided by the caller. */
    cnic: string | null;
    joiningDate: string | null; // YYYY-MM-DD
  };
  monthlySalary: number;
  earnings: { label: string; amount: number }[];
  deductions: { label: string; amount: number }[];
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
};

const BLUE = "#3b6fb6";
const GREY = "#6b7280";
const LINE = "#c9ced6";

const s = StyleSheet.create({
  page: { paddingVertical: 32, paddingHorizontal: 34, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 14 },
  headerSide: { width: "34%" },
  headerCenter: { width: "32%", alignItems: "center", paddingTop: 6 },
  metaRow: { flexDirection: "row", marginBottom: 3 },
  metaLabel: { fontFamily: "Helvetica-Bold" },
  blue: { color: BLUE },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  subtitle: { marginTop: 4, fontSize: 10 },
  brand: { alignItems: "flex-end" },
  company: { marginTop: 4, fontSize: 9.5, fontFamily: "Helvetica-Bold", textAlign: "right" },
  box: { borderWidth: 1, borderColor: LINE, marginBottom: 12 },
  infoRow: { flexDirection: "row" },
  infoCell: { width: "33.33%", flexDirection: "row", paddingVertical: 6, paddingHorizontal: 8 },
  infoLabel: { color: "#374151" },
  infoValue: { fontFamily: "Helvetica-Bold", flex: 1 },
  columns: { flexDirection: "row", marginBottom: 12 },
  column: { flex: 1, borderWidth: 1, borderColor: LINE, borderTopWidth: 3, borderTopColor: BLUE },
  colHead: { paddingVertical: 6, textAlign: "center", fontFamily: "Helvetica-Bold", fontSize: 10, borderBottomWidth: 1, borderBottomColor: LINE },
  colBody: { height: 230, paddingVertical: 4 },
  line: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 8, paddingVertical: 4 },
  lineLabel: { flexShrink: 1, paddingRight: 4 },
  dots: { flexGrow: 1, flexBasis: 0, borderBottomWidth: 1, borderBottomColor: LINE, borderBottomStyle: "dotted", marginBottom: 2.5, marginHorizontal: 2, minWidth: 8 },
  lineAmount: { color: BLUE, textAlign: "right", flexShrink: 0 },
  total: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: LINE, fontFamily: "Helvetica-Bold" },
  netBox: { borderWidth: 1, borderColor: LINE, paddingVertical: 8, paddingHorizontal: 10 },
  netRow: { flexDirection: "row", marginBottom: 4 },
  footer: { position: "absolute", bottom: 26, left: 34, right: 34, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6, fontSize: 7.5, color: GREY, flexDirection: "row", justifyContent: "space-between" },
});

/** Whole rupees with thousands separators: 100,000. */
const amount = (n: number) => Math.round(n).toLocaleString("en-US");
/** The built-in PDF font (WinAnsi) has no arrow glyph or other non-Latin-1 characters. */
const pdfText = (t: string) => t.replace(/→/g, "=").replace(/[‐‑‒–]/g, "-").replace(/×/g, "x");
const fmtDate = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" }).format(d);

/** "19/October/2026 9:31 PM" in Pakistan time. */
export function printDateLabel(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Karachi" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
}

function Meta({ label, value, blue }: { label: string; value: string; blue?: boolean }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaLabel}>{label}: </Text>
      <Text style={[{ flex: 1 }, blue ? s.blue : {}]}>{pdfText(value)}</Text>
    </View>
  );
}

function Info({ label, value }: { label: string; value: string | number | null }) {
  return (
    <View style={s.infoCell}>
      <Text style={s.infoLabel}>{label} : </Text>
      <Text style={s.infoValue}>{value === null || value === "" ? "--" : pdfText(String(value))}</Text>
    </View>
  );
}

function Lines({ title, lines, total }: { title: "Earning" | "Deduction"; lines: { label: string; amount: number }[]; total: number }) {
  return (
    <View style={s.column}>
      <Text style={s.colHead}>{title}</Text>
      <View style={s.colBody}>
        {lines.map((l, i) => (
          <View key={i} style={s.line} wrap={false}>
            <Text style={s.lineLabel}>{pdfText(l.label)}</Text>
            <View style={s.dots} />
            <Text style={s.lineAmount}>{amount(l.amount)}</Text>
          </View>
        ))}
      </View>
      <View style={s.total}>
        <Text>Total {title}</Text>
        <Text>{amount(total)}</Text>
      </View>
    </View>
  );
}

function PayslipPage({ d }: { d: PayslipData }) {
  const expected = d.kind === "expected";
  return (
    <Page size="A4" style={s.page}>
      <View style={s.header}>
        <View style={s.headerSide}>
          <Meta label="Print Date" value={printDateLabel(d.printDate)} blue />
          <Meta label="Printed By" value={d.printedBy} blue />
          <Meta label="Address" value={d.company.address ?? "--"} />
        </View>
        <View style={s.headerCenter}>
          <Text style={s.title}>{expected ? "Expected Payslip" : "Payslip"}</Text>
          <Text style={s.subtitle}>Month Of {d.period}</Text>
        </View>
        <View style={[s.headerSide, s.brand]}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          {d.company.logo ? <Image src={d.company.logo} style={{ width: 70, height: 42, objectFit: "contain" }} /> : null}
          <Text style={s.company}>{pdfText(d.company.legalName)}</Text>
        </View>
      </View>

      <View style={s.box}>
        <View style={s.infoRow}>
          <Info label="Employee Code" value={d.employee.code} />
          <Info label="Employee Name" value={d.employee.name} />
          <Info label="Station" value="Head Office" />
        </View>
        <View style={s.infoRow}>
          <Info label="Department" value={d.employee.department} />
          <Info label="Sub Department" value={null} />
          <Info label="Designation" value={d.employee.designation} />
        </View>
        <View style={s.infoRow}>
          <Info label="Cnic No" value={d.employee.cnic} />
          <Info label="Joining Date" value={d.employee.joiningDate} />
          <Info label="Monthly Salary" value={amount(d.monthlySalary)} />
        </View>
      </View>

      <View style={s.columns}>
        <Lines title="Earning" lines={d.earnings} total={d.totalEarnings} />
        <Lines title="Deduction" lines={d.deductions} total={d.totalDeductions} />
      </View>

      <View style={s.netBox} wrap={false}>
        <View style={s.netRow}>
          <Text style={s.metaLabel}>Net Payment : </Text>
          <Text style={[s.metaLabel, s.blue]}>{amount(d.netPay)}/-</Text>
        </View>
        <View style={{ flexDirection: "row" }}>
          <Text style={s.metaLabel}>Amount In Words : </Text>
          <Text style={{ flex: 1 }}>{rupeesInWords(d.netPay)}</Text>
        </View>
      </View>

      <View style={s.footer} fixed>
        <Text>{expected ? "Estimate only - final amounts are set when payroll is approved." : "Computer-generated payslip - no signature required."}</Text>
        <Text>{expected ? "Expected" : d.status === "PAID" ? `Paid${d.paidAt ? ` ${fmtDate(d.paidAt)}` : ""}` : "Approved"}</Text>
      </View>
    </Page>
  );
}

export async function renderPayslips(payslips: PayslipData[]): Promise<Buffer> {
  const first = payslips[0];
  const name = first?.kind === "expected" ? "Expected payslip" : "Payslip";
  return renderToBuffer(
    <Document title={payslips.length === 1 ? `${name} ${first!.period} ${first!.employee.code}` : `Payslips ${first?.period ?? ""}`} author="RFS HCM">
      {payslips.map((p, i) => <PayslipPage key={i} d={p} />)}
    </Document>,
  );
}
