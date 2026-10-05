# Phase 7 — Reports & Exports

Verified 5 October 2026. **Implemented and locally verified; uncommitted. Stop before Phase 8.** Phases 1–6 are committed through `3e31e14`.

## 1. Delivered scope

Five authenticated read-only operational reports, today's/current dashboard summaries and four on-demand authenticated CSV exports. Existing immutable business/clinical/invoice ledgers and the established exact money/security/UI architecture are reused.

## 2. Repository inspection and reuse

Inspected current handoff/architecture/deployment/recovery and Phase 4–6 reports; migrations 0001–0008 and indexes; customer/clinical/purchase/payment/invoice services/contracts; exact money/balance/shop/date/auth/audit/request/query helpers; dashboard/navigation/UI primitives and real-D1/browser fixtures. No AGENTS.md or existing configurable business timezone was found. Reporting extends the existing CSV helper and exports the existing calendar validator instead of replacing their contracts or introducing another financial system.

## 3. Sales report

Persisted purchase count, gross subtotal, discounts, recorded tax and grand total for inclusive purchase calendar dates. Saved complete purchases count before invoice generation despite their internal `draft` status. Void/refunded/deleted/non-INR activity is excluded. The optional joined invoice number is an identifier only. **Paid and outstanding are current balances for that purchase cohort, including receipts after the selected range; they are not historical period-end debt.** Details are paginated and totals are independent of the visible page.

## 4. Payment report

Settled/nondeleted INR receipts by **received time**, transaction count, exact collections, Cash/UPI/Card totals and received-business-day groups. Retained bank-transfer/other legacy methods reconcile through a separate legacy bucket without enabling new methods. Pending/voided/refunded/deleted receipts do not count. Payments can be collected against older purchases; collections and sales need not match. The response includes at most 366 nonempty daily groups and bounded receipt details, with original UTC timestamps labelled explicitly.

## 5. Outstanding and customer reports

Current all-date positive customer debt, phone/status, outstanding purchase count and amount; highest exact debt first with UUID tie-breaking. Fully paid/zero purchases contribute no debt, and archived customers retain debts. The existing Phase 5 credit contract covers all retained purchases, including legacy void/refunded/deleted debts, so a sales status filter cannot silently hide credit. Unsupported reversal/inconsistent/non-INR debt fails closed. Customer reports show total/active/archived, customers with any purchases/current debt and minimal paginated profile/current-credit fields. They reject date parameters.

## 6. Product categories

Immutable original item category snapshots for spectacle frames, prescription lenses, contact lenses, sunglasses, reading glasses, optical accessories and other products. SQL returns line count, total quantity and recorded line sales (line discounts/persisted line tax included); absent known categories have genuine zero totals. Unrecognized legacy values are bounded into an explicit eighth `unknown_legacy` bucket, retaining their counts/amounts. Purchase-level discounts are not allocated to categories, so category line sales can differ from purchase grand totals. No product stock/inventory metric is inferred.

## 7. Business-date semantics

`shared/reportDates.ts` centralizes **Asia/Kolkata, UTC+05:30**, real calendar validation and a maximum **366 inclusive days**. Sales/categories use `purchase_date`; only NULL legacy dates fall back to the IST day of `created_at`. The older customer-history API's UTC-prefix fallback is a historical contract, so a NULL legacy date near 18:30 UTC can differ from that listing. Invoice issue dates never replace purchase dates. An unassignable NULL legacy date fails closed instead of silently hiding a sale.

Payment ranges become a bound half-open UTC interval: IST midnight on the start date inclusive through IST midnight after the end date exclusive. For 9 April 2026 this is `2026-04-08T18:30:00.000Z <= received_at < 2026-04-09T18:30:00.000Z`. Millisecond and leap/century/year boundaries are verified. Presets: Today, Yesterday, Last 7 days/Last 30 days including today, This month to date, full Previous month, Custom. Dashboard computes its business day centrally; current credit/customer counts include every date.

## 8. Exact money and invalid data

Persisted/JSON values remain safe integer paise, bounded to **9,007,199,254,740,991**. SQL sums integer quotient/remainder components using base one billion, returns them as text and reconstructs only constant-size totals using BigInt; existing exact `asPaise`/`formatPaise` boundaries are reused. No floating monetary SUM, frontend page-derived total or full-table JavaScript aggregation is introduced. Unsafe aggregate amounts/counts return **409 `REPORT_TOTAL_OUT_OF_RANGE`**. Unsupported fractional/overpaid/reversed legacy balances return **409 `FINANCIAL_DATA_INVALID`**; records are never rounded, clamped or rewritten.

## 9. SQL, consistency and migration

Literal allowlisted report CTEs use prepared/bound values. Summary, row count and ordered details share one read-only D1 `batch()` snapshot: **three statements normally, four for payments**. Dashboard has **four summaries in one batch**. Applications do not issue per-row queries; the existing indexed balance view supplies correlated SQL ledger lookups. Detail order has deterministic identifier tie-breaks, and displayed summaries cover the complete scope rather than the current page.

**0009_report_indexes.sql is index-only**, applied locally in **2 commands**, with repeat reporting no pending migration. It adds partial `idx_purchases_report_date` on `COALESCE(purchase_date,date(created_at,'+330 minutes')) DESC,id`, exactly matching eligible sales/category predicates. The previous customer-leading/NULL-unaware indexes could not cover shop-wide range/order queries. A separate indexed NULL lookup keeps the actual range search efficient while detecting missing legacy dates. Actual joined query plans show an indexed range SEARCH without temporary sorting. Existing payment-status/received-time, settled-purchase and item-parent indexes are reused. No cached reporting tables or duplicate financial data exist.

## 10. API contracts and security

| Authenticated GET | Query |
|---|---|
| `/api/reports/dashboard` | Empty |
| `/api/reports/sales`, `/payments`, `/categories` | Required `dateFrom`, `dateTo`; optional `page`, `pageSize` |
| `/api/reports/outstanding`, `/customers` | Optional `page`, `pageSize`; no dates |
| `/api/reports/{sales|payments|categories}/export.csv` | Required dates; no pagination |
| `/api/reports/outstanding/export.csv` | Empty |

All paths reuse the existing owner session and central Blaze boundary. Unknown names/parameters, duplicates, malformed encoding, invalid/reversed/oversized dates and excessive pages fail safe validation. Unsafe methods retain exact-Origin/CSRF checks and expose no report mutation endpoint. Existing envelopes/errors/request IDs/log redaction, no-store/security headers and secret conventions apply. Report/export reads append no audits. Expired/revoked/unauthenticated downloads return safe JSON errors, never a CSV file. CSV sends through the framework writer with its capitalized Content-Type key, avoiding a duplicate octet-stream fallback while preserving middleware headers.

## 11. CSV format and privacy

Four exports: sales, payments, outstanding and categories. Selected authoritative scope, not just the visible page; UTF-8 BOM, CRLF, explicit headers, exact two-decimal INR strings and consistent labelled dates. Commas, quotes and embedded newlines are escaped. Formula prefixes `= + - @`, including prefixes hidden by whitespace/controls, receive an apostrophe text marker; +91 phone cells intentionally use that marker. Filenames contain only fixed report names and validated dates. No clinical values/customer addresses, notes/payment references, credentials, session/CSRF tokens or secret configuration appear. Downloads use credentialed no-store fetch and temporary revoked object URLs; there are no public caches, persistent exports, R2 objects or browser storage. CSVs are business exports, not full SQL backups.

## 12. UI and dashboard

Dedicated responsive Reports route with five report choices, presets/custom validation, exact server summaries, desktop tables/mobile labelled cards, per-page controls, stable links, honest empty/loading/error/retry states and CSV feedback. Out-of-range deep links recover to the available page. Current-state reports clearly disable date semantics. Reports/dashboard refetch on revisit (`staleTime: 0`) and provide explicit refresh; the app's general 30-second cache no longer delays those views. The dashboard replaces readiness cards with real today sales/collections/purchases and current debt/customer/debtor counts plus method totals. Real desktop/mobile screenshots were visually reviewed, with no document horizontal overflow or browser storage.

## 13. Bounds and performance verification

Maximum **50 rows/page**, **10,000 pages**, **366-day activity range**, **5,000 CSV rows**, **5 MiB UTF-8 CSV body**. Oversized exports return **413 `REPORT_EXPORT_TOO_LARGE`** rather than truncation. Category groups cap at eight; payment daily groups cap at 366. The disposable volume fixture contains **5,001 complete audited purchases/items** with production guards: constant three-statement reads, bounded ten-row page, full summary, a complete 5,000-row CSV, rejection after the extra row, and indexed real joined query plans passed. Outstanding/customer summaries necessarily aggregate retained shop data. Remote D1 latency/rows-read quota and Free-plan CPU budgets remain later acceptance work, not claims established by local tests.

## 14. Actual checks and fixes

- **1,073 workerd/D1 tests across 29 files**, all Phase 1–6 regressions plus **42 report/date/CSV/migration cases**.
- **41 real-backend Chromium scenarios**, all 33 earlier plus 8 reporting cases at 1440×960 and 390×844.
- TypeScript, ESLint, production build, dependency audit (**0 vulnerabilities**) and whitespace checks passed.
- All earlier native A4/short/multi-page/100-item invoice PDF/printing checks passed.
- Local migration repeat, foreign-key check (empty), quick check (`ok`) and nine-entry ledger passed.

Initial focused checks caught double-parsed numeric pagination and Blaze CSV Content-Type fallback; both were fixed. Browser checks corrected route-release/logout-status/request allowlist expectations and identified the inherited query-cache delay. Real query-plan review tightened range predicates. A local Wrangler startup timeout was resolved with noninteractive/metrics-disabled execution. Final equivalent individual backend gates and `CI=true WRANGLER_SEND_METRICS=false npm run test:e2e` passed after the final refinements; `npm run check` also passed earlier. Nonblocking existing Blaze sourcemaps/chunk-size warnings and five intentional deferred-FK rollback diagnostics retain passing assertions.

## 15. Preservation and interim live activity

Private initial before/after exports and hashes are ignored under `backups/phase-seven-before-20261005/` (0700 directory/0600 files). All original rows/rowids are retained; original owner/customer/clinical/four-audit values, migration 0001–0008/private-variable hashes and prior migration-ledger entries match. Index-only populated migration tests additionally verify unchanged original fields/root pages/FKs.

**The live database was not static during implementation:** one purchase/item/payment/invoice/reservation and five matching Phase 4–6 audit events were added through the existing live workflows. An audited shop identity edit changed name/address/contact/GSTIN; the corresponding invoice snapshot matches those values. The original counter advanced by exactly the new reservation; other original shop fields remain preserved. The initial equality check correctly detected this activity; verification was refined to retain and validate it instead of deleting/restoring it or claiming an unchanged database. No Phase 7 fixture is in the live database.

Final actual counts: **one owner/customer/prescription/purchase/item/payment/invoice/reservation; nine audits and nine migrations**. Genuine disposable report/export tests separately compare every financial/clinical/customer/invoice/settings/audit row and timestamp before/after reads, proving reporting itself is read-only. Live integrity is clean. Raw SQL records, identities and private secrets are not included in this report.

## 16. Files and limitations

New: `shared/reportDates.ts`, `shared/reports.ts`, `worker/validators/reports.ts`, `worker/services/reports.ts`, `worker/routes/reports.ts`, `migrations/0009_report_indexes.sql`, `src/lib/reports.ts`, `src/pages/ReportsPage.tsx`, `test/report-fixtures.ts`, `test/reports.test.ts`, `test/report-dates-csv.test.ts`, `test/report-migration-legacy.test.ts`, `e2e/reports.spec.ts`, this report.

Updated: shared calendar validator export, Worker route registration/foundation CSV helper, frontend routing/API download/dashboard/placeholder removal, exact historical migration test checkpoints, auth/customer/session browser expectations and the current status/README/architecture/test handoff.

Reports are current reads, not historical debt snapshots, an analytics warehouse, inventory or a tax engine. Header discounts are not allocated to categories. Current-state CSV beyond 5,000 debtors must use pagination; it cannot be narrowed with a misleading activity-date filter. Unrepresentable all-date credit requires explicit financial review. Only Chromium desktop/mobile is verified. Existing remote CPU/recovery/Free-plan/Unicode-search/printing-device limitations remain in the earlier architecture/runbooks. **Phase 8 has not started.** No new dependency, remote resource/migration/deploy, paid service, secret regeneration/private-variable edit, R2/images, new financial edit/refund/inventory workflow, reset/restore, staging or commit was performed.

## 17. Exact Git handoff — not executed

From the repository root, inspect `git status --short`, `git diff` and `git log --oneline -10` before committing. Review the new files as well. Stage only:

```bash
git add -- \
  PROJECT_STATUS.md README.md docs/architecture.md docs/phase-seven.md test/README.md \
  migrations/0009_report_indexes.sql \
  shared/purchaseValidation.ts shared/reportDates.ts shared/reports.ts \
  worker/index.ts worker/lib/csv.ts worker/routes/reports.ts \
  worker/services/reports.ts worker/validators/reports.ts \
  src/App.tsx src/lib/api.ts src/lib/reports.ts \
  src/pages/DashboardPage.tsx src/pages/ReportsPage.tsx src/pages/WorkspacePages.tsx \
  test/database.test.ts test/invoice-migration.test.ts test/report-fixtures.ts \
  test/reports.test.ts test/report-dates-csv.test.ts test/report-migration-legacy.test.ts \
  e2e/auth.spec.ts e2e/customers.spec.ts e2e/session.ts e2e/reports.spec.ts
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: implement reports and exports"
```

Private variables, `.wrangler/`, `dist/`, backups, cookies, PDFs, CSVs, screenshots and traces are ignored artifacts and are absent from this staging list. These commands are provided for the owner's review; no staging/commit was executed. Stop at Phase 7.
