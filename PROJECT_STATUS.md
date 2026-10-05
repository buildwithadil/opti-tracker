# OptiDesk project status

Last verified: 5 October 2026. Current handoff: Phase 6.

## Current stage

**Phase 6 — Invoice Generation & Printing: implemented and locally verified. Phase 7 has not started.**

Phases 1–5 are committed through `d474280 feat: implement payments and credit management` and their regression suites pass. Phase 6 changes are uncommitted. This is not a complete optical-shop release or an approved production deployment.

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
- Phase 6: one on-demand immutable invoice per purchase, authoritative versioned customer/shop/item/financial and payment-at-issue snapshots, safe sequential numbering and permanent audited number reservations.
- Minimal business information form reuses existing shop name/address/contact/GSTIN fields; no duplicate settings, numbering preferences or tax configuration API.
- Dedicated desktop/mobile invoice view with native A4 print, repeated table headers, preserved rows/totals and application chrome/buttons excluded.

## Latest actual checks

Implementation and regression verification ran:

```bash
npm run check
npm run test:e2e
```

| Gate | Actual result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Actual workerd/D1 tests | **1,031 passed across 26 files**, including Phase 1–5 regression suites |
| Real-backend Chromium | **33 passed**, including 27 earlier scenarios and 6 invoice desktop/mobile scenarios |
| Actual A4 output | Six PDFs verified; short documents one page; 100-item documents multi-page; desktop long document eight pages |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities** |
| Diff whitespace checks | Passed for tracked changes and new files |
| Existing local D1 migration | `0008_invoice_management.sql` applied: **16 commands**; repeat found no pending migrations |
| Preservation verification | Every existing table row/original column preserved; earlier migrations and private variables unchanged; foreign keys clean |
| Live local D1 integrity | Foreign-key check empty; quick check `ok`; migration ledger contains all eight files |

Invoice coverage includes unpaid/partial/paid/zero-total documents, multi-item discounts and persisted tax, minimal prescription/privacy, concurrent same/different-purchase generation, sequential uniqueness, duplicate/lost-response reuse, permanent failed reservations, skipped/wrong/pre-existing audit and later-statement rollback, all-column/no-op/REPLACE guards, hierarchy/security and historical snapshot behavior independent of later financial read-model changes. Browser checks invoke native print, generate real PDFs, inspect A4 metadata/text/every page's rendered ink margins, verify all 100 lines/repeated headers/final totals and exclude navigation/buttons. Short and first/last long PDF pages plus mobile view were visually inspected. Earlier regression suites also pass.

Nonblocking diagnostics: existing Blaze sourcemap messages and the >500 kB client chunk warning. Five intentional deferred-FK commit failures emit workerd/Miniflare rollback diagnostics; all assertions pass and verify pre-existing test records survive those failures.

## Database and API

Migrations 0001–0007 and their immutable financial records remain unchanged. Migration 0008 adds strict `invoices` and `invoice_number_reservations` tables, ownership/audit FKs, uniqueness/immutability/REPLACE guards and an authoritative snapshot view. Reservation insertion advances the existing `shop_settings.next_invoice_number` inside its transaction; a later failed issue retains the committed reservation. Never-reset numbering is supported; legacy collisions and unsupported policies fail closed. No purchase/payment row or historical settings/counter is rewritten by the migration.

Authenticated Blaze APIs:
- `GET /api/customers/:customerUuid/purchases/:purchaseUuid/invoice` — existing immutable invoice, or null for an owned purchase without one.
- `POST /api/customers/:customerUuid/purchases/:purchaseUuid/invoice` — issue once (201), otherwise reuse the existing invoice (200).
- `GET /api/shop/invoice-identity` — existing business name/address/contact/GSTIN and concurrency timestamp.
- `PATCH /api/shop/invoice-identity` — update those four fields with stale-write protection and atomic minimal audit.

Existing customer/prescription/purchase/payment APIs remain active. No destructive invoice, purchase or payment endpoint exists. Prior authentication, Origin/CSRF, strict validation, prepared SQL, response envelopes, no-store/security headers and audit conventions remain active.

The actual preserved local database has **one owner, one customer, one prescription, zero purchases/items/payments and four audit records**; new invoice/reservation tables are empty. Every existing table's original rows/columns/rowids and migration 0001–0007/private-variable hashes match the pre-implementation baseline. All invoice fixture records remain in disposable databases. Ignored private before/after exports and verification reports are under `backups/phase-six-before-20261005/` (directory 0700, files 0600); no reset/restore was performed.

## Monetary and historical rules

- API input amounts are decimal rupee strings; purchases allow zero, payments require a positive amount. Excess precision is rejected, never rounded.
- Stored/returned amounts are integer paise; BigInt parsing/intermediates and safe-integer checks prevent floating-point currency arithmetic and overflow.
- Subtotal is gross quantity × unit price summed across items. Whole-line discounts plus the optional purchase discount form the header discount. Grand total is subtotal − discount.
- New purchases have no tax calculation. Invoices copy actual persisted tax/financial fields without recalculating or altering them. Separate immutable payments reduce live outstanding without changing issued invoices.
- Paid = settled, nondeleted payment sum; outstanding = stored purchase total − paid. Zero-total purchases are paid; no balance/status is cached in a purchase row.
- Unsupported legacy posted reversals or inconsistent money return `FINANCIAL_DATA_INVALID`, without rounding, clamping or rewriting history. Unrepresentable customer aggregates return `CREDIT_TOTAL_OUT_OF_RANGE`.
- Cash/UPI/Card are the only new methods. Canonical UTC payment time cannot precede the purchase date's UTC midnight or be in the future.
- A prescription is optional, must exist and belong to the same customer, and retains its selected UUID permanently, including after a newer prescription/revision.
- Purchase-create audits include exact item snapshots and financial totals, owner/request identity, and omit notes, customer contacts and clinical measurements.
- Payment-create audits contain UUIDs, amount, method and received/created times with owner/request identity; reference, notes, contacts and clinical values are omitted.
- Invoice customer/shop/item/totals/payment-at-issue data is snapshotted once. Normal invoices exclude customer addresses and clinical measurements; only an optional prescription UUID is retained.
- Invoice and number-reservation audits store owner/request, IDs, number and timestamps, without duplicating customer/shop contacts or clinical information.

## Remaining limitations

- Purchases and payments cannot be edited/deleted, even to correct entry errors. Refunds/reversals/corrections require a separately approved append-only design.
- Item count 1–100, quantity 1–100,000, request size 16 KiB, monetary totals at most `Number.MAX_SAFE_INTEGER` paise, page size at most 50 and page number at most 10,000.
- Duplicate protection is scoped to one customer/submission UUID. Independent forms/new keys are not content-deduplicated; drafts/keys do not survive a reload or discard.
- Credit means purchase debt only, not a wallet, transferable credit or lending facility. Customer credit aggregation reads all purchases, not just a visible history page.
- Seven free-text optical categories/products; no catalog or inventory behavior. Prescription choices include explicit earlier versions; no clinical recommendation is inferred.
- Browser verification covers Chromium at desktop 1440×960 and mobile 390×844. Other engines/devices remain unverified.
- Issued payment figures are historical as-of values; later receipts remain on the purchase. No invoice corrections/reissue, legacy already-numbered document import or financial-year reset is enabled.
- Native printer/driver settings can override A4/margins/scaling; use A4 and disable browser headers/footers. Print tests require installed Poppler tools; physical printer hardware remains unverified.
- Earlier remote Free-plan PBKDF2 CPU/backup rehearsal and finite-quota/Unicode-search limitations remain as documented in prior reports.

## Boundaries and stop condition

**Stop at Phase 6. Phase 7 has not started and requires explicit approval.** No reports/CSV exports, analytics, inventory/catalog, R2/images, purchase/payment/credit editing or refunds were implemented. No new npm dependencies, remote resources/migrations/deployments, paid services, secret regeneration, `.dev.vars` edits, existing-record deletion, local database reset or Git commit occurred during Phase 6.

## Documentation

- [Architecture](docs/architecture.md)
- Historical reports: [Phase 1](docs/phase-one.md), [Phase 2](docs/phase-two.md), [Phase 3](docs/phase-three.md), [Phase 4](docs/phase-four.md), [Phase 5](docs/phase-five.md)
- [Phase 6 implementation report and exact staging/commit commands](docs/phase-six.md)
- [Deployment prerequisites](docs/deployment.md)
- [Backup/restore runbook](docs/backup-and-restore.md)
