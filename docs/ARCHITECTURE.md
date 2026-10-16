# RFS HCM — Architecture Proposal (v0.1, for approval)

**Owner:** Red Feather Solutions (RFS) (Private) Limited
**Purpose:** In-house HR, attendance and payroll platform replacing the FlowHCM subscription.
**Status:** Draft, awaiting answers to the open questions in §9 and approval before Phase 1 starts.

Defaults: currency PKR, timezone `Asia/Karachi` (UTC+5, no DST), A4 documents. Every business rule below is a
*configurable setting*. Where a value is shown as an example, it is not an assumption about RFS policy.

---

## 0. Confirmed decisions (2026-10-16)

| Topic | Decision | Notes / still to confirm |
|---|---|---|
| Hosting | **Hostinger Node.js web hosting** (rfstech.online) with a Hostinger **MySQL/MariaDB** database; Docker + MariaDB VPS stack kept as an alternative | Switched from PostgreSQL to MySQL/MariaDB on 2026-10-17 to run on the existing hosting. The device stays on the office LAN, so the **local sync agent is required** |
| Payroll period | Calendar month (1st – last day); **salary paid between the 5th and 10th of the following month** | Confirm this interpretation of "next month 5 – 10" |
| Per-day rate | Monthly salary ÷ **number of calendar days in that month** (28/29/30/31) | Confirm: basic only or basic + allowances? |
| Weekly off | **Saturday and Sunday** | |
| Late rule | **Every 3 late arrivals = 1 day's deduction** (`floor(lateCount / 3)`); **grace period 15 minutes** (late from 2:16 PM) | Confirmed 2026-10-16 |
| Absence | **Each absent day = 1 full day's deduction** (monthly salary ÷ days in month) | Confirmed 2026-10-16. Days not covered by device data are never treated as absent |
| Shift | **One shift: 14:00 – 23:00** (PKT) | Punch window spans midnight (10:00 → 06:00 next day) so late check-outs pair correctly |
| Tax | **No tax deduction for now** | Tax module built but switched off |
| Device | **ZKTeco MB460 Plus** (ZMM platform, ZKFinger VX10 / ZKFace VX7), serial TTQ52425003…, on **Ethernet**, supports **ADMS** | Integration: the device pushes over ADMS to the sync agent on the office PC (192.168.18.52:8081), which forwards over HTTPS. Verified with a simulated device; awaiting first real connection |
| Existing software | ZKBioTime is installed on the office PC (`C:\ZKBioTime`, web UI on port 80) | Is BioTime in active use with the device? This decides whether to read from BioTime or the device |

| Missing punch | **Counts as a late** towards the 3-lates = 1 day rule | Confirmed 2026-10-16 |
| Overtime | **Not paid** | Confirmed 2026-10-16 |
| Payroll approval | **HR prepares, Finance approves** (new Finance role); the submitter can never approve their own payroll | Confirmed 2026-10-16. Approval locks the month's attendance |
| Friday timing | **3:00 PM – 12:00 AM** (weekday override on the General Shift) | Confirmed 2026-10-16 |

Defaults applied without an explicit RFS rule (visible to HR in every payroll): joiners/leavers paid only for the calendar days employed; days with no machine data are never deducted, only flagged; amounts rounded to whole rupees.

Still open: leave entitlements and approval chain.

---

## 1. Requirements review — gaps that affect correctness

| Area | What is missing | Why it matters |
|---|---|---|
| ZKTeco device | Exact model, firmware, communication options (see §4.5) | Decides which protocol adapter we build. Different ZKTeco families speak different protocols. |
| Hosting | Cloud VPS vs a server inside the office | Decides whether we need the local sync agent at all. |
| Payroll period | Calendar month or a cutoff cycle (e.g. 26th–25th) | Affects every attendance-to-payroll calculation. |
| Per-day rate | Divisor: fixed 30, calendar days in month, or working days | A one-day deduction from PKR 80,000 is 2,667, 2,581 or ~3,636 depending on this choice. |
| Deduction rules | Late, absent, short-hours and missing-checkout policies | You asked us not to assume these. We need RFS's actual policy, or confirmation that HR decides each case manually. |
| Statutory | Income tax withholding, EOBI, provincial social security (PESSI/SESSI), provident fund | Tax slabs change every Finance Act. We need to know whether to calculate tax or let HR enter it. |
| Overtime | Who is eligible, rate, minimum threshold, whether it needs pre-approval | Directly affects net pay. |
| Leave | Entitlements, accrual vs upfront, carry-forward, half-day leave, sandwich rule, probation | Affects payable days. |
| Shifts | Are there night shifts crossing midnight? Rotating or flexible shifts? Ramadan timings? | Decides how punches are paired into a "work day". |
| Migration | Import existing employees, leave balances and history from FlowHCM? | Affects Phase 1 scope (import tooling). |
| Logins | Does every employee have a personal email? | Decides login by email vs Employee ID + password. |
| Notifications | SMTP/email provider? WhatsApp/SMS needed? | Affects notification module. |
| Scale | Number of employees, branches and devices | Sizing; also affects the multi-device design. |

The FlowHCM screenshot mentioned in the brief was not attached. If you share it, I'll match the dashboard to it.

---

## 2. Application architecture

A **modular monolith**: one deployable web app plus one background worker, sharing a typed domain core.
This keeps operations simple for an internal tool, and the modules can still be split apart later.

```
                      ┌──────────────────────── Cloud / Server (Docker) ────────────────────────┐
                      │                                                                          │
 Browser (HR, staff) ─┼─HTTPS─►  apps/web  (Next.js App Router, TypeScript)                      │
                      │           • UI (Tailwind + shadcn/ui, Recharts)                          │
                      │           • /api/v1/* route handlers  → service layer → Prisma           │
                      │           • SSE stream for live dashboard                                │
                      │                         │                                                │
                      │                         ▼                                                │
                      │                 MySQL/MariaDB  ◄──── apps/worker (Node)                  │
                      │                 (+ pg-boss job queue,   • attendance recompute           │
                      │                    LISTEN/NOTIFY)        • payroll calculation           │
                      │                                          • PDF / Excel generation        │
                      │                                          • notifications, backups        │
                      │                 Object storage (S3-compatible / local volume)            │
                      │                 logos, profile photos, payslip PDFs, exports             │
                      └────────────────────────────▲─────────────────────────────────────────────┘
                                                   │ HTTPS (outbound only), per-agent API key + HMAC
                ┌───────────── Office LAN ─────────┴───────────┐
                │  apps/sync-agent (Node, Windows service)      │
                │   • device adapter(s) ──LAN──► ZKTeco device  │
                │   • local SQLite outbox (survives offline)    │
                └───────────────────────────────────────────────┘
```

### Repository layout (npm workspaces)

The web app and worker are one package with two entry points. They share the same domain code, so there is
no cross-package build step. The sync agent is a separate package because it runs on a different machine.

```
prisma/              schema, migrations, seed
src/
  app/               Next.js routes (UI pages + /api/v1 route handlers)
  components/        UI components (shadcn/ui based)
  core/              pure domain logic: attendance, payroll, leave engines (no I/O, heavily unit-tested)
  server/            service layer: auth, RBAC guards, audit, data access
  worker/            background job entry point (pg-boss)
  lib/               env validation, formatting (PKR, PKT dates), utilities
agent/               on-premise sync agent (separate package; Windows service)
docker/              Dockerfiles, compose, Caddy, backup scripts
docs/
tests/               unit/integration/E2E
```

### Technology choices

| Concern | Choice | Reason |
|---|---|---|
| Web/UI | Next.js 15 (App Router), TypeScript strict, Tailwind, shadcn/ui | As requested |
| API | Versioned REST route handlers (`/api/v1`), Zod-validated input/output | The sync agent and any future mobile app need a stable API. Server Actions only call the same service layer. |
| DB | MySQL / MariaDB 11 + Prisma (originally PostgreSQL 16) | Matches Hostinger web hosting; list fields stored as JSON |
| Jobs | **pg-boss** (queue stored in Postgres) | Avoids running Redis; retries and scheduling are built in |
| Auth | In-house session auth: Argon2id password hashing, random session tokens stored hashed (SHA-256) in the DB, httpOnly + Secure + SameSite cookies | Small and fully auditable. Sessions can be revoked server-side; login is rate-limited and locks after repeated failures. TOTP 2FA for admins can be added later. |
| PDF | @react-pdf/renderer, server-side | No headless Chrome in the container; deterministic A4 output |
| Excel/CSV | exceljs / streaming CSV | |
| Live updates | Postgres `LISTEN/NOTIFY` → Server-Sent Events | Near-real-time dashboard without WebSocket infrastructure |
| Tests | Vitest (core/unit), Playwright (E2E), Testcontainers Postgres (integration) | The payroll and attendance engines get table-driven tests |
| Observability | pino structured logs, health endpoints, audit log table | |

---

## 3. Database design

Times are stored as UTC `timestamptz`. Business dates (`workDate`, payroll month) are `date` values calculated in
`Asia/Karachi`. Money is stored as `Decimal(14,2)` in PKR and never as a float.

### 3.1 Entity overview

```
Company 1─* Department 1─* Employee *─1 Designation
                              │  ├─ reportingManager → Employee (self relation)
                              │  ├─1 User (login, role)                 Role *─* Permission
                              │  ├─* ShiftAssignment ─→ Shift (effective-dated)
                              │  ├─* SalaryStructure (effective-dated) ─* SalaryComponent (allowances)
                              │  ├─1 BankAccount (encrypted, restricted)
                              │  ├─* EmergencyContact
                              │  └─* DeviceUserMap ─→ Device
Device 1─* RawPunch                    (immutable, unique dedupe key)
Device 1─* DeviceSyncLog
SyncAgent 1─* Device
Employee 1─* AttendanceDay ─* AttendanceCorrection (approval workflow)
Employee 1─* LeaveRequest ─→ LeaveType;  Employee 1─* LeaveBalance (per type, per year)
Holiday, WeeklyOffRule, AttendancePolicy, PayrollPolicy   (versioned, effectiveFrom)
PayrollPeriod 1─* PayrollRun 1─* PayrollItem 1─* PayrollLine
PayrollItem 1─1 Payslip (PDF in storage)
Employee 1─* SalaryAdvance 1─* AdvanceRecovery
PayrollAdjustment (corrections to locked periods, flows into a later run)
Approval (generic: who, when, decision, comment) — used by corrections, leave, payroll
AuditLog (actor, action, entity, before/after JSON, ip, timestamp) — append-only
```

### 3.2 Key tables (summary)

- **RawPunch** — `deviceId, deviceUserId, punchedAt (UTC), deviceLocalTime, verifyMode, punchState, rawPayload jsonb, receivedAt, agentId`.
  Unique `(deviceId, deviceUserId, punchedAt)` blocks duplicates at the database level. Rows are never updated or deleted.
  Punches whose `deviceUserId` has no matching employee are kept and flagged as *unmatched*. HR can map the user later and the attendance is recalculated.
- **AttendanceDay** — one row per employee per work date, *derived* from raw punches + shift + policy + leave + holidays:
  `firstIn, lastOut, workedMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes, status (PRESENT|ABSENT|HALF_DAY|LEAVE|HOLIDAY|WEEKEND|MISSING_OUT…), flags[], policyVersionId, isFinalised`.
  It can be recalculated at any time until its payroll period is locked.
- **AttendanceCorrection** — an employee or HR requests changed in/out times or status, with a reason. An approved correction overrides the derived value. The original values are preserved and audited.
- **PayrollRun / PayrollItem** — a run *snapshots* everything it used: attendance summary, salary structure, policy version and line-by-line calculation (`PayrollLine: type EARNING|DEDUCTION, code, label, basis, amount`).
  After `LOCKED`, the database rejects updates to the run's items (service guard plus a Postgres trigger).

### 3.3 Sensitive data

- Bank account number, IBAN and CNIC are encrypted per field with AES-256-GCM using a key from the environment, not the database. Only the `bank:read` permission can decrypt them, and every read is audited.
- **No fingerprint templates, face templates or biometric images are stored.** Only attendance event logs are imported.

---

## 4. ZKTeco biometric integration strategy

### 4.1 Principle

We do not assume a protocol. ZKTeco sells several device families, and they integrate differently. Families we may
encounter, **subject to confirming your model**:

1. **Standalone "pull" devices.** The device listens on the LAN, commonly on port 4370 (UDP/TCP), and attendance logs are read from it with ZKTeco's standalone SDK/protocol. Open-source implementations exist, but their compatibility varies by model and firmware.
2. **ADMS / "Push" devices.** If the device has a "Cloud Server / ADMS" setting, it pushes punches over HTTP to a configured server address.
3. **Devices managed by ZKBioTime / BioTime software.** If RFS already runs that software, we could read from its API or database instead of the device.

We only implement and claim support for the family your device has been **tested** against.

### 4.2 Adapter interface (`packages/devices`)

```ts
interface AttendanceDeviceAdapter {
  readonly kind: 'zk-standalone' | 'zk-adms' | 'zk-biotime' | string;
  testConnection(): Promise<DeviceInfo>;            // serial, firmware, clock, user/log counts
  fetchPunchesSince(cursor: SyncCursor): Promise<{ punches: DevicePunch[]; next: SyncCursor }>;
  getDeviceTime(): Promise<Date>;                   // to detect clock drift
  listUsers?(): Promise<DeviceUser[]>;              // user IDs/names only — never templates
}
```

To add a new model later, we add an adapter. The rest of the system does not change.

### 4.3 Local sync agent (when the device is only reachable on the office LAN)

- A small Node service installed on an always-on office PC or mini-server, running as a Windows service.
- It pulls from the device on a schedule (e.g. every 1–2 minutes, configurable). For push devices, it receives the device's push on the LAN, so the device is never exposed to the internet.
- Every punch is written first to a **local SQLite outbox**, then sent to the server with `POST /api/v1/agent/punches` over HTTPS.
  Each entry is removed from the outbox only after the server acknowledges it. If the internet is down, punches queue locally and are sent when the connection returns. Retries use exponential backoff.
- **Security:** connections go outbound only. Each agent has its own API key, requests are HMAC-signed with a timestamp to block replay, and keys can be revoked from the admin UI. No inbound ports are opened on the office router.
- **Idempotency:** the dedupe key is `deviceSerial + deviceUserId + punchedAt`. Resending the same batch is harmless.
- **Health:** the agent sends a heartbeat every minute with device reachability, device clock drift, outbox size and last successful pull. The admin UI shows *Online / Device unreachable / Agent offline*, plus the last sync time.
- **Manual sync:** an admin clicks "Sync now". The server queues a command, and the agent picks it up on its next heartbeat.
- **Configuration:** device IP, port, comm key/password, timezone and poll interval are managed in the admin UI and pulled by the agent. The comm key is stored encrypted.

If the server is hosted inside the office network, the worker can talk to the device directly and the agent is optional.

### 4.4 From punches to attendance

The device's "check-in/check-out" state key is often pressed wrongly, so by default it is **ignored**. Instead:
the first punch inside the shift window is IN and the last punch is OUT. Punches within N minutes of each other are
merged. The window for night shifts is configurable. This behaviour is a policy setting and can be switched to
use device states.

### 4.5 Device details I need from you

1. Exact model printed on the device or label (e.g. *K40, MB20, MB160, F18, uFace 800, SpeedFace V5L…*).
2. Firmware version (*Menu → System Info → Device Info / Firmware*).
3. Serial number.
4. Does the communication menu show **Cloud Server Setting / ADMS**? Or only **Ethernet (IP, port 4370)**?
5. Current IP address, port and whether a **Comm Key / password** is set.
6. Is it connected to the office LAN by cable or Wi-Fi, and is the IP static?
7. Is any ZKTeco software (ZKTime.Net, ZKBioTime, BioTime 8) installed today?
8. Approximately how many users and stored attendance logs it holds, and how far back logs go.
9. Do the device user IDs match FlowHCM employee codes?
10. Is the device clock currently correct in Pakistan time?

Before Phase 2 we run a short **compatibility spike**: connect to your device, read device info and 100 logs, and
confirm the adapter works on real hardware.

---

## 5. Payroll calculation model

### 5.1 Calculation pipeline (per employee, per period)

```
1. Salary basis      = SalaryStructure effective in the period (basic + fixed allowances), prorated for joiners/leavers
2. Attendance summary= from finalised AttendanceDay rows: working days, present, paid leave, unpaid leave,
                       absent, half days, late count, short-hour days, approved OT minutes
3. Earnings          = basic + allowances + approved overtime + bonuses + arrears/adjustments
4. Deductions        = each enabled deduction rule (see 5.2) → candidate lines
                       + unpaid leave + advance recovery + other authorised deductions + statutory (if enabled)
5. HR review         = candidate deductions may be waived/overridden per employee with a reason (audited)
6. Gross / Total deductions / Net payable  (rounding rule configurable, e.g. nearest rupee)
```

Each step writes `PayrollLine` rows that explain the result, e.g. *"Absent 2 days × (80,000 ÷ 30) = 5,333.33"*.
The same engine produces the **Estimated Salary** for employees, running on non-final attendance and clearly
labelled as an estimate.

### 5.2 Configurable rule types (none are on until HR turns them on)

| Rule | Configurable parameters |
|---|---|
| Per-day rate | divisor: `FIXED_30` · `CALENDAR_DAYS` · `WORKING_DAYS`; base: basic only or gross |
| Absence | deduct days × per-day rate; or no automatic deduction |
| Late arrival | grace minutes; e.g. "every N lates = X day deduction"; or per-minute; or flag only |
| Short hours / early leave | threshold; converts to half day; or flag only |
| Missing check-out | treat as present / half day / absent / needs correction |
| Half day | threshold hours; deduction fraction |
| Overtime | eligibility per employee/grade, minimum minutes, rate multiplier on hourly rate, requires approval |
| Unpaid leave | days × per-day rate |
| Weekend/holiday handling | sandwich rule on/off |
| Statutory | income-tax mode (`MANUAL` amount or `SLAB_TABLE` HR keeps updated per fiscal year), EOBI, social security, PF — each on/off with amounts or rates |
| Advances | recovery amount per month, auto-schedule |

Policies are **versioned with an `effectiveFrom` date**. A payroll run always records which version it used.

### 5.3 Approval and locking workflow

```
DRAFT ──calculate──► CALCULATED ──submit──► UNDER_REVIEW ──approve──► APPROVED ──lock──► LOCKED ──mark paid──► PAID
   ▲                     │ recalc allowed          │ reject (back to DRAFT, reason required)
   └─────────────────────┘
```

- Recalculation is only allowed before approval. **Maker-checker:** the person who prepares a run cannot approve it. Roles for each step are configurable.
- When a run is locked, the attendance days in that period are frozen. Later syncs or corrections for that period do **not** change it. They create a pending **PayrollAdjustment**, which HR approves and which is paid or recovered in the next open run.
- Payslips are generated automatically on approval and published to employees on lock (configurable).
- Each status change writes an Approval record and an AuditLog entry.

### 5.4 Payroll questions that block Phase 3 (answer in §9)

The per-day divisor, the cycle and cutoff dates, the late/absent/short-hour policies, overtime, how tax and EOBI/social security are applied, proration, rounding, and the payment method (bank transfer list format?).

---

## 6. Roles and access control

Access is permission-based (e.g. `employee:read`, `payroll:approve`, `bank:read`), and each permission has a
**scope**: `SELF`, `TEAM` (direct and indirect reports), `DEPARTMENT` or `ALL`. Roles are bundles of
permissions. Super Admin can edit them.

| Role | Default scope highlights |
|---|---|
| Super Admin | everything, including settings, devices, roles, payroll config |
| HR Admin | employees (ALL), attendance, leave, payroll prepare, payslips, reports; bank data only if granted |
| Manager | attendance/leave of TEAM, approve team leave & corrections, team reports; no salary data by default |
| Employee | SELF only |

Enforcement happens in layers:

1. Every API handler calls `authorize(actor, permission, resource)` in the service layer.
2. Queries are automatically filtered by scope through a Prisma client extension, so a missing filter cannot leak data.
3. Salary and bank tables are never returned by generic employee endpoints.
4. The UI hides actions as a convenience only.

Tests cover each role against each sensitive endpoint.

---

## 7. Page structure

```
/login, /forgot-password
/(app)
  /dashboard                     HR dashboard (role-aware widgets) | employee "My dashboard"
  /employees                     list, filters, import
  /employees/new
  /employees/[id]                tabs: Overview · Attendance · Leave · Salary · Payroll history · Payslips · Documents · Audit
  /attendance                    daily register (filters: employee, department, date range)
  /attendance/calendar           monthly calendar per employee / team
  /attendance/corrections        request queue & approvals
  /attendance/unmatched          punches with unknown device user IDs
  /leave                         requests & approvals
  /leave/balances
  /payroll                       periods list
  /payroll/[periodId]            run preview, employee-wise breakdown, review, approve, lock
  /payroll/[periodId]/[empId]    line-by-line breakdown
  /payroll/adjustments
  /payslips                      history, bulk generate/download
  /reports                       report catalogue → filters → Excel/CSV/PDF
  /me                            self-service: profile, attendance, estimated salary, payslips, leave, corrections
  /settings
    /company  /working-days  /holidays  /shifts  /attendance-policy  /payroll-policy
    /leave-types  /roles  /users  /devices (agents, devices, sync logs)  /notifications  /audit-log  /backups
```

UI: left sidebar plus top bar, navy/white/grey with blue accents, light and dark themes, and responsive tables that become cards on mobile.

---

## 8. Implementation plan

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **0. Decisions & spike** (now) | Answers to §9; device compatibility spike | Architecture approved; device read confirmed |
| **1. Foundation** | Monorepo, Docker compose (web, worker, postgres), Prisma schema + migrations + seed (RFS company record, roles), auth & sessions, RBAC, app shell/theme, employee CRUD + profile, activate/deactivate, audit log, CSV import (if migrating) | Each role can sign in; RBAC tests pass; employees can be managed |
| **2. Attendance** | Device adapter(s), sync agent + outbox + installer, agent API, device admin UI, raw punch storage, attendance engine + policies, shifts, holidays, register/calendar, corrections workflow, live dashboard | Real punches flow end-to-end; offline test passes (unplug internet, no loss, no duplicates) |
| **3. Payroll** | Salary structures, payroll policies, engine with explanation lines, preview/review/approve/lock, adjustments, advances, estimated salary | Engine tests against hand-calculated RFS examples; lock is immutable |
| **4. Payslips & Leave** | A4 payslip PDF, bulk generation, employee access, leave types/balances/requests/approvals wired into attendance & payroll, full self-service | HR signs off payslip layout; leave affects payroll correctly |
| **5. Reports & Deploy** | All reports with exports, security review, E2E tests, production Docker, HTTPS, automated encrypted DB backups + restore drill, runbook | Restore drill succeeds; parallel run with FlowHCM for one payroll month matches or differences are explained |

**Recommendation:** run RFS HCM in parallel with FlowHCM for one full payroll month before cancelling the subscription.

---

## 9. Open questions

### Company & hosting
1. Legal name for documents: "Red Feather Solutions (RFS) (Private) Limited"? Also the address, NTN and logo file for payslips.
2. Hosting: cloud VPS (which provider?) or a server/PC in the office? Will you own a domain for it (e.g. `hr.<yourdomain>.com`)?
3. How many employees, branches and biometric devices today?
4. Import existing data from FlowHCM (employees, leave balances, attendance history)? Can FlowHCM export Excel?
5. Does every employee have an email? Otherwise they log in with Employee ID.
6. Email sending: Google Workspace / Microsoft 365 / other SMTP?

### Device
7. The ten device details in §4.5.

### Attendance
8. Shifts: list all current shifts. Any night shifts crossing midnight, rotating shifts, or Ramadan timings?
9. Weekly off days: Saturday and Sunday? Same for everyone?
10. Does the device's IN/OUT key matter, or should we use first and last punch (recommended)?
11. Overtime: who is eligible, how it is approved, and how it is paid.

### Payroll
12. Payroll cycle: calendar month, or a cutoff such as 26th–25th? Salary payment date?
13. Per-day rate divisor: 30, calendar days, or working days? Calculated on basic or gross?
14. Current policy for absence, late arrival, short hours and missing check-out. If HR decides case by case, we keep these as flags with manual deductions.
15. Income tax: should the system calculate it from FBR slabs (HR updates the slab table each budget), or will HR enter monthly tax manually?
16. EOBI, PESSI/SESSI, provident fund, gratuity: which apply to RFS?
17. Joiners and leavers mid-month: prorate by which divisor?
18. Salary advances and loans: recovery rules?
19. Payment: bank transfer? Do you need a bank upload file (which bank)?
20. Who prepares payroll and who approves it? Should there be two different people (recommended)?

### Leave
21. Leave types and annual entitlements; accrual or credited upfront; carry-forward and encashment; half-day leave; probation rules; sandwich rule.
22. Approval chain: manager only, HR only, or manager then HR?
