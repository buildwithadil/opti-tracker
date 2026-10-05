# OptiDesk project status

Last verified: 5 October 2026. Current handoff: Phase 4.

## Current stage

**Phase 4 — Purchase Management: implemented and locally verified. Phase 5 has not started.**

Phases 1–3 are committed through `e74aa4f` and their regression suites pass. Phase 4 changes are uncommitted. This is not a complete optical-shop release or an approved production deployment.

## Delivered

- Phase 1: single-owner authentication, secure sessions, exact-Origin/CSRF protection, throttling, security headers and responsive shell.
- Phase 2: authenticated customer CRUD/search/filter/sort/pagination, canonical Indian mobile uniqueness, archive/restore and atomic audits.
- Phase 3: dated customer-linked spectacle prescriptions, exact signed measurements, explicit unknown/null values and append-only revision history.
- Phase 4: customer purchases with 1–100 optical line items, seven product categories, original description/category/quantity/price/discount/total snapshots, dates, notes and optional same-customer prescription links.
- Backend-calculated integer-paise line/subtotal/discount/grand totals; live frontend preview shares the exact computation.
- Customer-scoped history with pagination, inclusive date-range and item-category filters; immutable purchase details and readable archived-customer history.
- Five-statement atomic D1 creation with constant query count, conditional active-customer checks, database-enforced complete item sets and creation audits.
- Stable in-memory submission UUIDs plus database unique protection; concurrent/double/lost-response retries cannot duplicate the same submission.
- Responsive item add/remove forms, paginated exact-version prescription choices, empty/loading/error/success states and unsaved cancel/navigation/back/reload protection.

## Latest actual checks

The final implementation run succeeded:

```bash
npm run check && npm run test:e2e
```

| Gate | Actual result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Actual workerd/D1 tests | **901 passed across 19 files**, including Phase 1–3 regression suites |
| Real-backend Chromium | **19 passed**, including 11 earlier scenarios and 8 purchase desktop/mobile scenarios |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities** |
| `git diff --check` | Passed |
| Existing local D1 migration | `0006_purchase_management.sql` applied: **23 commands**; repeat found no pending migrations |
| Preservation verification | Every existing table row/original column preserved; earlier migrations and private variables unchanged; foreign keys clean |
| Live local D1 integrity | Foreign-key check empty; quick check `ok`; migration ledger contains all six files |

Coverage includes strict monetary precision and overflow, multiple/max-100 items with five batch statements, empty/partial/unaudited SQL rejection, customer/Rx isolation, all-column/no-op immutable guards, SQL replacement/append protection, audit and later-item rollback, archive races, consistent paginated snapshots and minimal sensitive audit data. Browser coverage includes exact totals after reload, older Rx selection across pages, multiple/remove/empty items, server errors retaining input, double submit, genuine lost-response duplicate rejection, date/category filtering and desktop/mobile overflow/storage checks.

Nonblocking diagnostics: existing Blaze sourcemap messages and the >500 kB client chunk warning. Two intentional deferred-FK commit-failure tests emit workerd/Miniflare rollback diagnostics; all assertions pass and verify pre-existing test owner/customer/audits survive those failures.

## Database and API

Migration 0006 extends the existing purchase and item tables without rebuilding them. New fields: header `client_request_id`, `creation_audit_id`, `item_count`; item `snapshot_position`. Unique submission/audit/position indexes and customer/date history index are added. A deferred restrictive audit FK plus insert guards make empty/partial purchases unable to commit. All purchase/item rows reject update/delete; replacement and post-creation item append paths are guarded. Legacy rows remain unchanged and become read-only.

Authenticated Blaze APIs:
- `GET /api/customers/:customerUuid/purchases` — customer purchase history; `page`, `pageSize`, `dateFrom`, `dateTo`, `category`.
- `POST /api/customers/:customerUuid/purchases` — atomic purchase plus items and audit; HTTP 201.
- `GET /api/customers/:customerUuid/purchases/:purchaseUuid` — immutable details.

No edit/delete purchase endpoint exists. JSON aliases established `id`/`customer_id`/`prescription_id` columns as UUID fields. The earlier auth/customer/prescription conventions are retained.

The actual preserved local database has **one owner, one customer, one prescription, zero purchases/items/payments**. The prescription created since the Phase 3 snapshot was retained. All purchase test records are in disposable databases. An ignored private SQL export, hashes and verification report are under `backups/phase-four-before-20261005T110000Z/`; no reset/restore was performed.

## Monetary and historical rules

- API input amounts are nonnegative decimal rupee strings; excess precision is rejected, never rounded.
- Stored/returned amounts are integer paise; BigInt parsing/intermediates and safe-integer checks prevent floating-point currency arithmetic and overflow.
- Subtotal is gross quantity × unit price summed across items. Whole-line discounts plus the optional purchase discount form the header discount. Grand total is subtotal − discount.
- New purchases have no tax/invoice/payment operation. Existing legacy financial fields remain preserved and readable.
- A prescription is optional, must exist and belong to the same customer, and retains its selected UUID permanently, including after a newer prescription/revision.
- Purchase-create audits include exact item snapshots and financial totals, owner/request identity, and omit notes, customer contacts and clinical measurements.

## Remaining limitations

- Purchases cannot be edited or deleted, even to correct entry errors. A separately approved append-only correction strategy is needed.
- Item count 1–100, quantity 1–100,000, request size 16 KiB, monetary totals at most `Number.MAX_SAFE_INTEGER` paise, page size at most 50 and page number at most 10,000.
- Duplicate protection is scoped to one customer/submission UUID. Independent forms/new keys are not content-deduplicated; drafts/keys do not survive a reload or discard.
- Seven free-text optical categories/products; no catalog or inventory behavior. Prescription choices include explicit earlier versions; no clinical recommendation is inferred.
- Browser verification covers Chromium at desktop 1440×960 and mobile 390×844. Other engines/devices remain unverified.
- Earlier remote Free-plan PBKDF2 CPU/backup rehearsal and finite-quota/Unicode-search limitations remain as documented in prior reports.

## Boundaries and stop condition

**Phase 4 only. Phase 5 has not started and requires explicit approval.** No payment recording, outstanding balances, credit allocation, invoice generation, inventory, R2/images, reports or financial dashboard metrics were implemented. No new dependencies, remote resources/migrations/deployments, paid services, secret regeneration, `.dev.vars` edits, existing-record deletion, local database reset or Git commit occurred.

## Documentation

- [Architecture](docs/architecture.md)
- Historical reports: [Phase 1](docs/phase-one.md), [Phase 2](docs/phase-two.md), [Phase 3](docs/phase-three.md)
- [Phase 4 implementation report and exact staging/commit commands](docs/phase-four.md)
- [Deployment prerequisites](docs/deployment.md)
- [Backup/restore runbook](docs/backup-and-restore.md)
