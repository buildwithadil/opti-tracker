# OptiDesk project status

Last verified: 6 October 2026. Current handoff: mobile-first redesign locally accepted; remote staging and production remain approval-gated.

## Current stage

**Mobile-first redesign after Phase 8 — local acceptance complete; remote staging and production approval blocked by the prerequisites below. The application is not deployed or approved for production use.**

Phases 1–7 are committed through `ea6f27e feat: implement reports and exports`; the Phase 8 baseline is `e948138 chore: complete OptiDesk production readiness`. The redesign is uncommitted review work on `redesign/mobile-first-shop-workflow`. It adds no migration and preserves the persistent local database.

## Delivered

- Phases 1–6: single-owner authentication/security; canonical searchable/archiveable customers; dated immutable prescription revisions; complete immutable purchase/item snapshots; Cash/UPI/Card payments and derived credit; permanent numbered invoices and A4 printing.
- Sales reports: saved purchase count, gross subtotal, discounts, persisted tax, grand total and current paid/outstanding position for an inclusive purchase-date range.
- Payment reports: effective collections, transaction count, Cash/UPI/Card and retained legacy-method totals, bounded receipt details and business-day grouping.
- Outstanding reports: current positive customer debts across all purchases/dates, phones, archived status and outstanding purchase counts, highest debt first. Fully paid and zero-total purchases contribute no debt.
- Customer reports: total/active/archived profiles, customers with purchases/debts and paginated minimal contact/current-credit details.
- Category reports: seven established immutable category snapshots, line counts, quantity and recorded line sales; an explicit unknown-legacy bucket retains unrecognized categories. Purchase discounts are not allocated to categories.
- Operational dashboard: today's sales/collections/purchase count, current total credit/customer/debtor counts and effective payment-method totals.
- Mobile-first shop workflow: Home/Sales/Customers/More shell, persistent New Sale, direct Receive Payment and Outstanding, inline customer/prescription entry, customer summary/profile tabs and payment history.
- Protected shop read views: all-date sales, customer balance/last-sale summaries and payment receipts with strict bounds, authoritative integer-paise balances and legacy review behavior.
- Responsive reports with presets/custom validation, independent full-range SQL summaries, pagination, empty/loading/error/retry states and authenticated downloads.
- Four on-demand UTF-8 CSV exports: sales, payments, outstanding and categories, with exact rupee decimals, quote/newline escaping, formula defenses and server-enforced row/byte limits.

## Latest actual checks

| Gate | Actual result |
|---|---|
| TypeScript / ESLint | Passed |
| Actual workerd/D1 tests | **1,099 passed across 31 files**, including Phase 1–8 regressions and redesign shop/legacy API checks |
| Real-backend Chromium | **57 passed**, including the Rahul workflow, checkout/collection recovery and seven required viewports |
| Existing invoice output | A4/native-print/short/multi-page/100-item PDF regressions passed |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities** |
| CSV volume | Complete 5,000-row download passed; 5,001 rows safely rejected |
| Query strategy | Three statements per ordinary report, four for payments/dashboard; real sales/date query plan uses the new range index without a temporary sort |
| Local migration | Fresh isolated `0001`–`0009` application passed; existing and restored database repeats found nothing pending; no Phase 8 migration |
| Local integrity | Foreign-key check empty; `quick_check: ok`; nine migration entries |
| SQL recovery | Full export/checksum/prepared import into empty isolated D1; schema/all original business fields, original-password login, session revocation, historical invoice and unique reconciled numbering passed |
| Local preservation | Before/after full SQL byte-identical; original rows/fields/physical rowids/schema/migration/private-variable hashes unchanged |
| Production artifacts | Built references/security headers/routing/bindings verified; known private secrets, live-record identifiers and test credentials absent from built runtime; private artifacts absent from seven committed histories |
| Remote deployment / smoke | **Not performed**; approval, bindings, account quotas and deployed KDF CPU remain gates |

The complete redesign result table and exact local staging/demo build verification are in [mobile-first redesign](docs/mobile-first-redesign.md). `npm run build:staging` selects `CLOUDFLARE_ENV=staging`, Worker `optidesk-staging`, binding `DB` and `VITE_DEMO_MODE=true`; no remote action is implied by that local build.

`npm run check`, `CI=true WRANGLER_SEND_METRICS=false npm run test:e2e`, `npm audit` and `git diff --check` passed. After strengthening the final scenario with console/resource checks and all seven desktop/mobile routes, TypeScript/ESLint, its focused run and the complete **42-scenario browser/build suite** passed again. Existing Blaze sourcemap/chunk-size warnings and five intentional deferred-FK rollback diagnostics remain nonblocking; their regression assertions pass. See [Phase 8](docs/phase-eight.md) for actual results and fixes.

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

Phase 8 adds no migration. Migrations 0001–0009, private variables, the complete local schema and every original table/row/field/physical rowid match its baseline. The full before/after SQL exports are byte-identical.

**Historical Phase 7 live activity was retained:** one purchase/item, payment, invoice/reservation and five associated audit events, plus its audited shop identity/counter change. Those records were already present at the Phase 8 baseline and remain identical. Phase 8's complete workflow and recovery records exist only in disposable isolated databases.

Actual final local counts: **one owner, customer, prescription, purchase, item, payment, invoice, reservation and shop; nine audit records and nine migrations**. Phase 8 private exports/snapshots/verification/artifact-review reports are in `backups/phase-eight-20261005/` (directory 0700, files 0600); the historical Phase 7 evidence remains in its original private directory. Foreign keys are clean and `quick_check` is `ok`.

## API and limits

- `GET /api/reports/dashboard`
- `GET /api/reports/{sales|payments|outstanding|customers|categories}`
- `GET /api/reports/{sales|payments|outstanding|categories}/export.csv`

Every endpoint requires the existing owner session. Strict query/path validation, bound SQL, safe errors, no-store/security headers and unchanged unsafe-method Origin/CSRF checks apply. Report/export reads append no audits. CSV bodies contain no clinical measurements, private notes/payment references, credentials or tokens.

Detail pages: maximum 50 rows/page, page 10,000. CSV: maximum 5,000 rows and 5 MiB, never silently truncated; it exports the selected range independently of the displayed page. Payment daily groups: maximum 366. Current debt/customer aggregation necessarily reads retained shop records; remote D1 latency/rows-read and Free-plan CPU remain unverified. Chromium desktop/mobile layouts and actual downloads were verified and screenshots visually reviewed.

## Production blockers and handoff

1. Explicit approval is required before Cloudflare login/account inspection, resource creation, remote migration, secret changes or deployment. No remote operation has been performed.
2. The source D1 binding has no database ID; approved account, separate staging/production bindings/names/origins and actual shared Free-plan usage are unresolved.
3. Native 600,000-iteration PBKDF2 setup/login/password-change CPU must pass an approved **Free-plan staging** benchmark, including repeated warm/practical cold measurements. Local tests do not prove the 10 ms CPU budget; the work factor remains unchanged.
4. The owner must confirm actual invoice identity and tax/document requirements. Local identity fields are populated; the existing GSTIN passes the application's broad format but fails a standard GSTIN structure check. Its validity has not been certified or changed.
5. Remote staging recovery/acceptance, production bootstrap/deployment, controlled production smoke and independent backup scheduling remain unperformed. No new infrastructure or paid service was introduced.

Local readiness is complete; production release is pending these gates. Stage/commit commands are provided for review only, and no Git staging/commit was performed.

- [Architecture](docs/architecture.md)
- [Phase 8 final report and exact unexecuted staging/commit commands](docs/phase-eight.md)
- [Test coverage](test/README.md)
- Historical reports: [Phase 1](docs/phase-one.md), [Phase 2](docs/phase-two.md), [Phase 3](docs/phase-three.md), [Phase 4](docs/phase-four.md), [Phase 5](docs/phase-five.md), [Phase 6](docs/phase-six.md), [Phase 7](docs/phase-seven.md)
- [Deployment](docs/deployment.md) / [backup and recovery](docs/backup-and-restore.md)
