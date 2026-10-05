# OptiDesk project status

Last verified: 5 October 2026. Current handoff: Phase 7.

## Current stage

**Phase 7 — Reports & Exports: implemented and locally verified. Phase 8 has not started.**

Phases 1–6 are committed through `3e31e14 feat: implement invoice generation and printing`. Phase 7 changes are uncommitted. This is a local implementation checkpoint; production approval remains a later gate.

## Delivered

- Phases 1–6: single-owner authentication/security; canonical searchable/archiveable customers; dated immutable prescription revisions; complete immutable purchase/item snapshots; Cash/UPI/Card payments and derived credit; permanent numbered invoices and A4 printing.
- Sales reports: saved purchase count, gross subtotal, discounts, persisted tax, grand total and current paid/outstanding position for an inclusive purchase-date range.
- Payment reports: effective collections, transaction count, Cash/UPI/Card and retained legacy-method totals, bounded receipt details and business-day grouping.
- Outstanding reports: current positive customer debts across all purchases/dates, phones, archived status and outstanding purchase counts, highest debt first. Fully paid and zero-total purchases contribute no debt.
- Customer reports: total/active/archived profiles, customers with purchases/debts and paginated minimal contact/current-credit details.
- Category reports: seven established immutable category snapshots, line counts, quantity and recorded line sales; an explicit unknown-legacy bucket retains unrecognized categories. Purchase discounts are not allocated to categories.
- Operational dashboard: today's sales/collections/purchase count, current total credit/customer/debtor counts and effective payment-method totals.
- Responsive reports with presets/custom validation, independent full-range SQL summaries, pagination, empty/loading/error/retry states and authenticated downloads.
- Four on-demand UTF-8 CSV exports: sales, payments, outstanding and categories, with exact rupee decimals, quote/newline escaping, formula defenses and server-enforced row/byte limits.

## Latest actual checks

| Gate | Actual result |
|---|---|
| TypeScript / ESLint | Passed |
| Actual workerd/D1 tests | **1,073 passed across 29 files**, including all Phase 1–6 regressions and 42 reporting cases |
| Real-backend Chromium | **41 passed**, including all 33 previous scenarios and 8 reporting scenarios |
| Existing invoice output | A4/native-print/short/multi-page/100-item PDF regressions passed |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities** |
| CSV volume | Complete 5,000-row download passed; 5,001 rows safely rejected |
| Query strategy | Three statements per ordinary report, four for payments/dashboard; real sales/date query plan uses the new range index without a temporary sort |
| Local migration | `0009_report_indexes.sql` applied in **2 commands**; repeat found nothing pending |
| Local integrity | Foreign-key check empty; `quick_check: ok`; nine migration entries |

The final backend gates ran with `npm run typecheck`, `npm run lint`, `npm test`; browser/build gates ran with `CI=true WRANGLER_SEND_METRICS=false npm run test:e2e`. `npm run check` also passed before the final query/cache refinements; the equivalent individual gates passed again after them. A local Wrangler startup timeout was resolved by a noninteractive/metrics-disabled retry. Existing Blaze sourcemap/chunk-size warnings and five intentional deferred-FK rollback diagnostics remain nonblocking; their regression assertions pass.

## Dates, money and current credit

- Reporting business timezone is centralized as **Asia/Kolkata / IST (UTC+05:30)**. No existing shop timezone preference was found; reporting does not add a second settings store.
- Sales/categories use the saved calendar `purchase_date`; a NULL legacy date falls back to `created_at` converted to IST. Invoice issue time is not the sales date.
- Payment dates convert inclusive IST days to a half-open canonical UTC interval: start midnight inclusive, midnight after the end date exclusive. Detail timestamps remain labelled UTC.
- Today/Yesterday/Last 7 days/Last 30 days/This month to date/Previous month/Custom are supported. Ranges are at most 366 inclusive days.
- Outstanding and customer reports are current all-date positions. Sales paid/outstanding figures are also current, not historical balances at the end of the selected period.
- Live debt reuses `purchase_payment_balances`, including the established all-retained-purchase semantics. Archived or legacy void/refunded/deleted purchase debts are not silently hidden from customer credit; sales activity excludes void/refunded/deleted/non-INR purchases.
- Effective payments are settled/nondeleted; pending/voided/refunded/deleted receipts do not count. Existing bank-transfer/other methods remain an explicit legacy collection bucket without enabling new methods.
- SQL sums integer billion-paise/count components, with constant-size BigInt reconstruction and existing safe integer-paise validation. Unsafe aggregates return `REPORT_TOTAL_OUT_OF_RANGE`; unsupported legacy finance/date/reversal data fails closed without rewriting it.

## Database preservation

Migration 0009 adds one partial expression index only. Migrations 0001–0008 and private-variable hashes match the initial baseline; their existing migration-ledger entries are preserved. The original owner, customer, prescription and four audit records remain identical.

**Interim live activity was observed and retained:** one purchase/item, one payment, one invoice/reservation and five associated Phase 4–6 audit events were added during this session. The original shop's identity fields were updated through the existing audited identity workflow, and its counter advanced by one corresponding reservation. The updated shop fields match the issued invoice snapshot; all other original shop fields remain preserved. These additions are not disposable Phase 7 fixtures and were not rolled back.

Actual final local counts: **one owner, one customer, one prescription, one purchase/item/payment/invoice/reservation, nine audit records and nine migrations**. The ignored private before/after exports and verification report are in `backups/phase-seven-before-20261005/` (directory 0700, files 0600). Disposable backend/browser tests independently verify that reports/exports do not change any financial, clinical, customer, invoice, settings or audit row. All Phase 7 fixtures, including the 5,001-sale dataset, remain isolated from this database.

## API and limits

- `GET /api/reports/dashboard`
- `GET /api/reports/{sales|payments|outstanding|customers|categories}`
- `GET /api/reports/{sales|payments|outstanding|categories}/export.csv`

Every endpoint requires the existing owner session. Strict query/path validation, bound SQL, safe errors, no-store/security headers and unchanged unsafe-method Origin/CSRF checks apply. Report/export reads append no audits. CSV bodies contain no clinical measurements, private notes/payment references, credentials or tokens.

Detail pages: maximum 50 rows/page, page 10,000. CSV: maximum 5,000 rows and 5 MiB, never silently truncated; it exports the selected range independently of the displayed page. Payment daily groups: maximum 366. Current debt/customer aggregation necessarily reads retained shop records; remote D1 latency/rows-read and Free-plan CPU remain unverified. Chromium desktop/mobile layouts and actual downloads were verified and screenshots visually reviewed.

## Stop condition and handoff

**Stop at Phase 7. Phase 8 has not started.** Broader preferences/security/recovery acceptance remains separately gated. No remote resources/migration/deployment, new dependency, paid service, image/R2 storage, inventory workflow, financial edit/refund, private-variable change, database reset/restore or Git commit was performed for Phase 7.

- [Architecture](docs/architecture.md)
- [Phase 7 report and exact unexecuted staging/commit commands](docs/phase-seven.md)
- [Test coverage](test/README.md)
- Historical reports: [Phase 1](docs/phase-one.md), [Phase 2](docs/phase-two.md), [Phase 3](docs/phase-three.md), [Phase 4](docs/phase-four.md), [Phase 5](docs/phase-five.md), [Phase 6](docs/phase-six.md)
- [Deployment](docs/deployment.md) / [backup and recovery](docs/backup-and-restore.md)
