# RFS HCM

HR, attendance and payroll platform for **Red Feather Solutions (RFS) (Private) Limited**.
It replaces the FlowHCM subscription. PKR · Asia/Karachi · ZKTeco biometric attendance.

Architecture, decisions and open questions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 1. Foundation | Auth, roles & permissions, app shell, employees, salary & bank records, company/org settings, users, audit log, Docker deployment | **Done** |
| 2. Attendance | ZKTeco sync agent, punches, attendance engine & pages | Waiting on device model/firmware |
| 3. Payroll | Policies, monthly calculation, approval & locking, estimated salary | Waiting on remaining payroll answers |
| 4. Payslips & Leave | PDF payslips, leave management, self-service | Planned |
| 5. Reports | Exports, hardening | Planned |

## Local development (Windows)

Requirements: Node 22+, Docker Desktop.

```bash
npm install
cp .env.example .env               # then set FIELD_ENCRYPTION_KEY (command is in the file)
npm run db:up                      # PostgreSQL 16 on 127.0.0.1:5433
npm run db:deploy                  # apply migrations
npm run db:seed                    # company record, roles, default 2 PM – 11 PM shift
ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='TempPass123' npm run user:create-admin
npm run dev                        # http://localhost:3000
```

The first sign-in asks for a new password.

| Command | Purpose |
|---|---|
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:migrate` | Create a migration after editing `prisma/schema.prisma` |
| `npm run db:studio` | Browse the database |

## Deployment (Hostinger VPS)

1. Use a KVM VPS with Ubuntu 22.04/24.04 and install Docker Engine with the compose plugin.
2. Point a DNS A-record (e.g. `hr.yourdomain.com`) at the VPS IP. Open ports 80 and 443 only.
3. Copy the repository to the server, then:
   ```bash
   cp docker/.env.prod.example docker/.env.prod   # fill in every value
   docker compose -f docker/compose.prod.yml --env-file docker/.env.prod up -d --build
   docker compose -f docker/compose.prod.yml --env-file docker/.env.prod exec web \
     sh -c "ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='TempPass123' npx tsx scripts/create-admin.ts"
   ```
   Migrations and the seed run automatically when the container starts. Caddy issues the HTTPS certificate.
4. **Backups:** the `backup` service writes a compressed dump every night at 02:00 PKT to `docker/backups/`.
   Copy these off the server too, because backups only on the VPS are lost with it. Store `FIELD_ENCRYPTION_KEY` safely
   and separately: without it, the encrypted bank details and CNICs cannot be read.

PostgreSQL is not exposed outside the Docker network. The ZKTeco device stays on the office LAN. In Phase 2 a
small sync agent in the office will push attendance to the server over HTTPS, so no router ports are opened.

## Security model (summary)

- Passwords are hashed with Argon2id. Sessions are stored server-side and can be revoked: 12-hour idle timeout, 7-day maximum. After 5 failed sign-ins the account locks for 15 minutes.
- Permissions have scopes (`self` / `team` / `department` / `all`) and are checked on the server in every action and page. Queries are filtered to what the user may see (`src/server/auth/scope.ts`).
- CNIC, bank account number and IBAN are encrypted with AES-256-GCM. Revealing them is logged.
- The audit log is append-only, enforced by a database trigger.
- Only a Super Admin can grant or manage Super Admin access. The system keeps at least one active Super Admin.
