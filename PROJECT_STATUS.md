# OptiDesk project status

Last verified: 4 October 2026. This file was absent at the start of Phase 2 and is now the current handoff record.

## Current stage

**Phase 2 — Customer Management: implemented and locally verified.**

Phase 1 authentication remains functional. Phase 3 has not started. OptiDesk is not a complete optical-shop application or an approved production deployment.

## Delivered

- Phase 1: single-owner bootstrap/login/session/logout/password change, Origin/CSRF protection, rate limiting, security headers, neutral responsive application shell.
- Phase 2: authenticated customer creation/details/editing; canonical Indian mobile normalization; active-phone uniqueness; literal name/full-phone/partial-digit search; bounded pagination and sorting; active/archived/all filters; soft archiving and conflict-safe restoration.
- Responsive customer table/mobile cards, inline field/conflict errors, success feedback, profiles with dates, confirmation dialogs, and unsaved-form navigation/reload protection.
- Atomic customer/audit writes with administrator/request identity and guarded revisions. Customer records cannot be permanently deleted.
- Purchase and prescription history sections are explicitly unavailable, not fabricated empty business history. Future module pages remain phase notices.

## Latest actual verification

| Gate | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | **536 passed across 11 files**, actual workerd/D1 |
| `npm run test:e2e` | **5 passed**, real local Worker/D1 and Chromium; authentication + desktop/mobile customer CRUD/search/archive/restore/conflicts/dirty forms |
| `npm run build` | Passed |
| `npm audit` | **0 vulnerabilities reported** |
| `git diff --check` | Passed |
| `npm run db:migrate:local` | Applied `0004_customer_management.sql`; repeat run had no pending migrations |
| Local preservation verification | Owner, private secrets, 0001–0003 and all unrelated application rows unchanged; foreign keys clean |

The existing local D1 owner count remains one and customer count remains zero; no browser-test data was copied into that database. An ignored private SQLite backup was taken before the local migration. All original migrations are retained unchanged.

## Database and API

Migration `0004_customer_management.sql` reconciles the existing `customers` table to `uuid`, `name`, `phone`, `normalized_phone`, `created_at`, `updated_at`, `archived_at`; legacy optional columns are retained, with an internal `revision` added. Existing prescription/purchase foreign keys now reference `customers(uuid)` without changing stored identity values. A partial unique index on `normalized_phone WHERE archived_at IS NULL` permits archived-number reuse.

Authenticated APIs:
- `GET /api/customers`
- `POST /api/customers`
- `GET /api/customers/:uuid`
- `PATCH /api/customers/:uuid`
- `DELETE /api/customers/:uuid` — **archive only**, never hard delete
- `POST /api/customers/:uuid/restore`

See [Phase 2 report](docs/phase-two.md) for contracts, migration details, tests, and limitations.

## Remaining risks and limits

- Cloudflare Free-plan deployed PBKDF2 CPU compliance remains unmeasured. No hashing work factor was lowered.
- Remote backup/restore rehearsal and complete business acceptance remain release gates.
- Name search uses SQLite's ASCII case-insensitive behavior; non-ASCII case folding/diacritic-insensitive search is not implemented. Substring searches/counts can scan candidate rows and consume D1 quotas despite bounded returned pages.
- Mobile normalization checks Indian number structure, not whether a number is assigned/reachable. Only documented grouping/prefix forms are accepted; no OTP/SMS service is introduced.
- Populated migration deliberately aborts for malformed legacy phones or active canonical duplicates rather than silently dropping/merging records. Resolve such data through an approved maintenance procedure before migrating another database.
- Nonblocking package sourcemap and >500 kB client-chunk build warnings are recorded in the Phase 2 report.
- Browser verification is Chromium, at 1440×960 and 390×844; this is not a cross-browser certification.

## Not performed

No remote Cloudflare provisioning, migration, export, restore, deployment, paid-service activation, image upload, R2 integration, secret regeneration, or Git commit occurred during Phase 2. The user's pre-existing development server was left running; test servers are stopped.

## Next phase — not started

Phase 3: prescription management, only after a separate request. Purchases, payments, invoice generation, taxes, metrics, reports, exports, and editable shop settings remain future phases.

## Documentation

- [Architecture](docs/architecture.md)
- [Phase 1 report — historical checkpoint](docs/phase-one.md)
- [Phase 2 report](docs/phase-two.md)
- [Deployment prerequisites](docs/deployment.md)
- [Backup/restore runbook](docs/backup-and-restore.md)
