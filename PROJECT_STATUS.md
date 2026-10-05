# OptiDesk project status

Last verified: 5 October 2026. Current handoff: Phase 5.

## Current stage

**Phase 5 — Payments & Credit Management: implemented and locally verified. Phase 6 has not started.**

Phases 1–4 are committed through `cd0e82c feat: implement purchase management module` and their regression suites pass. Phase 5 changes are uncommitted. This is not a complete optical-shop release or an approved production deployment.

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
- Phase 5: positive Cash/UPI/Card payments against an existing purchase, partial/full settlement, chronological paginated individual payment history and optional reference/note.
- Backend-derived paid/outstanding amounts and Unpaid/Partially paid/Paid status; customer total outstanding credit across all purchases, without changing purchase totals/items/timestamps.
- Four-statement atomic payment/audit/response/balance D1 batch; database-level concurrent overpayment, customer/archive/date, duplicate and immutable-ledger guards.
- Responsive payment forms with in-memory submission UUIDs, synchronous locking, dirty-form protections, retained drafts and authoritative stale-balance/duplicate refresh.

## Latest actual checks

The final implementation run succeeded:

```bash
npm run check && npm run test:e2e
```

| Gate | Actual result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Actual workerd/D1 tests | **1,004 passed across 23 files**, including Phase 1–4 regression suites |
| Real-backend Chromium | **27 passed**, including 19 earlier scenarios and 8 payment desktop/mobile scenarios |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities** |
| Diff whitespace checks | Passed for tracked changes and new files |
| Existing local D1 migration | `0007_payment_management.sql` applied: **15 commands**; repeat found no pending migrations |
| Preservation verification | Every existing table row/original column preserved; earlier migrations and private variables unchanged; foreign keys clean |
| Live local D1 integrity | Foreign-key check empty; quick check `ok`; migration ledger contains all seven files |

Payment coverage includes exact one-paise/safe-range amounts, partial/full/zero-total status, all-customer credit and aggregate overflow, forced racing genuine D1 writes, duplicate keys across purchases, archive races, audit/later-statement rollback, skipped-audit commit failure, all-column/no-op immutable/REPLACE guards, scoped reads and snapshot-consistent history. Browser coverage includes all three methods, unchanged purchase snapshots, customer aggregate refresh, stale-balance field focus/draft retention, dirty cancel/navigation/back/reload, double submit, genuine full-payment lost-response retry, >20 payment pagination and archived readability. Earlier auth/customer/clinical/purchase checks also pass.

Nonblocking diagnostics: existing Blaze sourcemap messages and the >500 kB client chunk warning. Three intentional deferred-FK commit-failure tests emit workerd/Miniflare rollback diagnostics; all assertions pass and verify pre-existing test records survive those failures.

## Database and API

Migration 0006's immutable purchase/item snapshots remain unchanged. Migration 0007 extends the existing `payments` table without rebuilding it: nullable `client_request_id` and deferred restrictive `creation_audit_id` FK, unique customer/submission and audit indexes, history/settled lookup indexes, immutable/REPLACE and atomic creation guards. `purchase_payment_balances` derives balances/status from persisted records. Existing legacy payments/reversals remain unchanged; new reversal writes are disabled.

Authenticated Blaze APIs:
- `GET /api/customers/:customerUuid/credit-summary` — total customer outstanding in integer paise.
- `GET /api/customers/:customerUuid/purchases/:purchaseUuid/payments` — chronological history; `page`, `pageSize`; snapshot-consistent count/balance.
- `POST /api/customers/:customerUuid/purchases/:purchaseUuid/payments` — atomic immutable payment plus creation audit; HTTP 201.
- `GET /api/customers/:customerUuid/purchases/:purchaseUuid/payments/:paymentUuid` — customer/purchase-scoped individual record.

The three existing purchase endpoints remain active and now include derived payment fields. No edit/delete payment or purchase endpoint exists. JSON aliases existing identity columns as UUID fields; prior authentication, Origin/CSRF, validation, response envelopes, no-store/security headers and audit conventions remain active.

The actual preserved local database has **one owner, one customer, one prescription, zero purchases/items/payments and four audit records**. Every existing table's original rows/columns/rowids and migration 0001–0006/private-variable hashes match the pre-implementation baseline. Payment test records remain in disposable databases. Ignored private before/after exports and verification reports are under `backups/phase-five-before-20261005/` (directory 0700, files 0600); no reset/restore was performed.

## Monetary and historical rules

- API input amounts are decimal rupee strings; purchases allow zero, payments require a positive amount. Excess precision is rejected, never rounded.
- Stored/returned amounts are integer paise; BigInt parsing/intermediates and safe-integer checks prevent floating-point currency arithmetic and overflow.
- Subtotal is gross quantity × unit price summed across items. Whole-line discounts plus the optional purchase discount form the header discount. Grand total is subtotal − discount.
- New purchases have no tax/invoice operation. Separate immutable payments reduce outstanding without altering any purchase financial field.
- Paid = settled, nondeleted payment sum; outstanding = stored purchase total − paid. Zero-total purchases are paid; no balance/status is cached in a purchase row.
- Unsupported legacy posted reversals or inconsistent money return `FINANCIAL_DATA_INVALID`, without rounding, clamping or rewriting history. Unrepresentable customer aggregates return `CREDIT_TOTAL_OUT_OF_RANGE`.
- Cash/UPI/Card are the only new methods. Canonical UTC payment time cannot precede the purchase date's UTC midnight or be in the future.
- A prescription is optional, must exist and belong to the same customer, and retains its selected UUID permanently, including after a newer prescription/revision.
- Purchase-create audits include exact item snapshots and financial totals, owner/request identity, and omit notes, customer contacts and clinical measurements.
- Payment-create audits contain UUIDs, amount, method and received/created times with owner/request identity; reference, notes, contacts and clinical values are omitted.

## Remaining limitations

- Purchases and payments cannot be edited/deleted, even to correct entry errors. Refunds/reversals/corrections require a separately approved append-only design.
- Item count 1–100, quantity 1–100,000, request size 16 KiB, monetary totals at most `Number.MAX_SAFE_INTEGER` paise, page size at most 50 and page number at most 10,000.
- Duplicate protection is scoped to one customer/submission UUID. Independent forms/new keys are not content-deduplicated; drafts/keys do not survive a reload or discard.
- Credit means purchase debt only, not a wallet, transferable credit or lending facility. Customer credit aggregation reads all purchases, not just a visible history page.
- Seven free-text optical categories/products; no catalog or inventory behavior. Prescription choices include explicit earlier versions; no clinical recommendation is inferred.
- Browser verification covers Chromium at desktop 1440×960 and mobile 390×844. Other engines/devices remain unverified.
- Earlier remote Free-plan PBKDF2 CPU/backup rehearsal and finite-quota/Unicode-search limitations remain as documented in prior reports.

## Boundaries and stop condition

**Stop at Phase 5. Phase 6 has not started and requires explicit approval.** No invoice generation/numbering/printing, refunds, wallets/lending, inventory, R2/images, reports/exports or financial dashboard metrics were implemented. No new dependencies, remote resources/migrations/deployments, paid services, secret regeneration, `.dev.vars` edits, existing-record deletion, local database reset or Git commit occurred during Phase 5.

## Documentation

- [Architecture](docs/architecture.md)
- Historical reports: [Phase 1](docs/phase-one.md), [Phase 2](docs/phase-two.md), [Phase 3](docs/phase-three.md), [Phase 4](docs/phase-four.md)
- [Phase 5 implementation report and exact staging/commit commands](docs/phase-five.md)
- [Deployment prerequisites](docs/deployment.md)
- [Backup/restore runbook](docs/backup-and-restore.md)
