# Phase 6 — Invoice Generation & Printing

Implemented and verified locally on **5 October 2026**. Phases 1–5 are committed through `d474280 feat: implement payments and credit management`. Phase 6 began from a clean working tree and remains uncommitted. **Phase 7 has not started.**

## 1. Features implemented

- Explicit generation of one permanent invoice per saved purchase, then immutable retrieval/reprinting.
- Authoritative customer/shop/original item/financial and payment-at-issue snapshots; no purchase/payment changes or second money system.
- Unique sequential numbers using the existing shop counter, permanent audited reservations and safe concurrent/retry/lost-response behavior.
- Unpaid, partially paid, fully paid and zero-total documents with actual method totals and balance due.
- Minimal invoice business-information editing in the existing settings store.
- Dedicated desktop/mobile view and native A4 printing with repeated table headers and no application chrome/buttons.

## 2. Invoice database schema

Migration **`0008_invoice_management.sql`** adds strict tables without altering original business rows or migrations 0001–0007:

| Table | Fields and constraints |
|---|---|
| `invoice_number_reservations` | UUID, purchase/customer/shop FKs, customer-scoped submission UUID, globally unique sequence and formatted number, owner/time and unique deferred restrictive creation-audit FK |
| `invoices` | UUID, unique purchase/reservation/number, customer/purchase/reservation/owner FKs, issue time, versioned snapshot JSON and unique deferred restrictive creation-audit FK |

An authoritative `invoice_source_snapshots` view builds the document from persisted rows. INSERT guards require exact source snapshot equality, valid financial data, complete bounded item sets, matching hierarchy/reservation/audit and invoiceable purchase state. UPDATE/DELETE/no-op/REPLACE guards preserve both ledgers. Customer/purchase lookup indexes are added. Cross-namespace guards prevent reserved numbers colliding with old `purchases.invoice_number` values.

The existing purchase invoice fields remain untouched: Phase 4's immutability deliberately prohibits assigning a number or JSON onto that header. New invoice tables are document/number ledgers, not another financial ledger.

## 3. Invoice numbering strategy

Reuse `shop_settings.invoice_prefix`, `next_invoice_number`, `invoice_number_padding` and supported `invoice_reset_policy='never'`. SQL formatting matches the existing `invoiceNumber()` helper, for example **`INV-0001`**. UUIDs identify rows, but uniqueness does not depend on timestamps/browser state.

The reservation INSERT validates the currently persisted counter and advances it in an AFTER trigger **inside the same serialized D1 transaction**. Sequence and formatted numbers are unique; the counter cannot go backward or reuse a retained number. Safe sequence range is 1–9,007,199,254,740,990; the final counter may be one higher. Financial-year resets are not implemented and fail closed.

Two separate transactional batches intentionally distinguish allocation from issuance:

1. Reserve number + minimal reservation audit + reservation read (**3 statements**, committed first).
2. Invoice insert from the authoritative snapshot view + minimal creation audit + invoice read (**3 statements**).

An issue/audit failure after allocation leaves the reservation, its audit and advanced counter committed. Its number is never silently returned to the pool. Concurrent independent same-purchase requests can leave unused reserved numbers but only one invoice; **gaps are intentional**. A reservation transaction that itself fails allocates nothing and exposes no invoice/number.

Legacy collisions require explicit sequence review; no old row is rewritten or automatically renumbered. After restore, recover missing externally printed documents and advance beyond every printed/issued/reserved/legacy sequence before reopening writes. Database guards cannot discover documents absent from an old backup. See [recovery](backup-and-restore.md) and [deployment](deployment.md).

## 4. Invoice lifecycle

Generate explicitly on demand, once, then reuse. A Phase 4 purchase is a complete saved immutable transaction despite its internal `draft` tag; full payment is not required. First generation returns 201, later requests return the same invoice with 200. No destructive edit, deletion, regeneration, correction or reissue exists.

Stable in-memory submission UUID and synchronous UI lock protect uncertain retries/double-clicks. If issuance succeeded but the response was lost, retry returns the same invoice/number without another reservation. A reused key with no issued invoice returns `INVOICE_GENERATION_INCOMPLETE`; the UI explicitly offers **Generate with a new number**, retaining the previous allocation. Independent concurrent requests are ultimately protected by unique purchase ownership and serialized writes.

Archived customers require restoration for first issuance; already issued invoices remain readable. Void/refunded/deleted/non-INR and already-numbered legacy purchases cannot receive a new Phase 6 invoice. Legacy invoice snapshot JSON has no verified historical document contract, so it is preserved rather than guessed/imported.

## 5. Historical snapshot strategy

Version 1 snapshots copy these values **inside the issue transaction**, never reconstructing them from browser data/current products. The issue timestamp uses SQLite's clock inside the INSERT and the audit copies that persisted time, so a queued request cannot claim an as-of time before a payment included in its snapshot:

| Snapshot | Data and reason |
|---|---|
| Shop | Name, address, contact, optional GSTIN and existing footer: preserve original issuer identity |
| Customer | Name and phone: preserve original recipient identity; address is optional legacy data not required by this application and is excluded |
| Purchase | UUID/date, fixed optional prescription UUID, currency, stored subtotal/discount/taxable/tax/component/grand totals: preserve original transaction |
| Items | Ordered original UUID/description/category/quantity/unit price/discount/taxable/rate/type/tax/HSN/line total: preserve historical line snapshots |
| Payments | Phase 5 paid/outstanding/status, effective payment count and per-method totals: preserve payment position at issue without duplicating sensitive receipts |

Invoice identity/number/time are stored separately. Clinical measurements, prescriber/customer notes, purchase/payment notes and payment references are excluded. Later customer/shop changes, new payments or financial read-model changes do not alter retrieval/reprinting. GET verifies ownership against base customer/purchase identities and reads the permanent invoice independently of a live balance view.

## 6. Payment representation

The Phase 5 view supplies settled, nondeleted paid amounts, outstanding and status. Per-method totals/count include only those same effective payments. No payment is invented, edited or deleted. Legacy method text is retained when applicable.

The document clearly labels **Payment position at issue**, its UTC as-of timestamp, Purchase total, Total paid at issue and Balance due at issue. Cash/UPI/Card method amounts are individually shown when present. Unpaid/Partially paid/Paid and zero-balance paid documents remain explicit. Later receipts/live balance appear in purchase history, not silently on an old invoice.

## 7. Tax/GST handling and limitations

Copy actual persisted purchase/item tax amounts, components, recorded rates and HSN/SAC values. Display only actual configured GSTIN. Do not apply the current shop's default tax rate to historical purchases, infer missing tax components or recalculate totals. New Phase 4 purchases record no tax and the document states that fact. A legacy recorded tax amount can be shown even when old components/rates were not populated; missing information is not invented.

This is an invoice representation, **not a claim of legal GST compliance**. There is no tax engine, new tax configuration API or automatically compliant tax-invoice template. Business document requirements still require actual shop inputs and business review before production.

## 8. API endpoints and authoritative validation

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/customers/:customerUuid/purchases/:purchaseUuid/invoice` | Existing immutable invoice, or null for an owned purchase without one |
| POST | Same invoice path | Body contains only `client_request_id`; 201 first issue, 200 reuse |
| GET | `/api/shop/invoice-identity` | Existing name/address/contact/GSTIN and concurrency timestamp |
| PATCH | Same identity path | Those four fields plus prior `updated_at`; guarded update + audit + response |

Strict schema rejects client invoice numbers, identities, totals, payments and item values. Missing/cross-customer purchase returns safe 404; all full hierarchy values are bound. The existing Blaze administrator/session, exact-Origin/CSRF, JSON/16 KiB limits, parameterized SQL, response envelopes, minimal error logs, no-store/security headers apply. No public print-data or destructive invoice route exists.

Configuration edits use an optimistic timestamp plus `changes()`-conditional audit to avoid lost writes/phantom audits. Only existing business fields are editable; numbering, reset policy, tax, footer preferences and general settings remain outside Phase 6. Empty required business identity prevents issuance. GSTIN validation is formatting only, not verification of registration.

Generation audits include owner/request, invoice/purchase/customer UUIDs, number and event timestamp. Reservation audit also records sequence. Contacts, shop address and clinical/notes/reference payloads are not copied into audits. Deferred restrictive audit anchors reject skipped/wrong/pre-existing audit associations, and later statement failure rolls the applicable batch back.

## 9. Frontend and print implementation

- Purchase details provide **View invoice**; dedicated authenticated `/customers/:uuid/purchases/:purchaseUuid/invoice` supports explicit generation, view, errors/retry and **Print invoice**.
- Settings gains only the required business-information form using existing UI, React Hook Form/Zod, inline validation, save feedback and dirty/pending navigation/reload protection.
- Screen document uses professional typography/hierarchy, issuer/recipient, number/date, compact immutable item table, totals and payment position. Mobile uses labelled item cards rather than horizontal overflow.
- Native `window.print()` waits for fonts. CSS `@page` uses **A4 portrait and 14 mm margins**; print media removes app shell/navigation/mobile header/buttons/background and restores unrestricted document width.
- Printed table headers repeat; rows, customer/header and totals blocks avoid awkward splitting; long text wraps. Print always uses the table even from a mobile viewport.
- No browser data persistence, external font/image service, PDF runtime library or customization feature is added. Browser printing/Save as PDF is native; no business export API is introduced.

Use A4, default/100% scale and disable browser-generated headers/footers in the print dialog. Printer/driver/user overrides are outside CSS control.

## 10. Actual A4 and multi-page verification

Six real-backend Chromium invoice cases cover desktop **1440×960** and mobile **390×844**. Each triggers the native print function and observes `beforeprint`; the same Chromium print engine generates PDFs with preferred CSS page size, no browser headers/footers and no artificial business responses.

Poppler tools already installed in the environment inspect actual PDF metadata/text and rasterized output. Assertions verify:

- A4 page dimensions (observed **594.96 × 841.92 points**).
- One-page partial/paid short invoices; both desktop and mobile 100-item unpaid invoices have **8 pages**.
- Customer/shop/number/line/method/totals data; all 100 line identifiers survive extraction.
- Table headings repeat on every item page; final totals are on the last page.
- No application navigation, back link, print button or other application chrome in PDF text or print media.
- All PDF font boxes stay within physical page bounds and **every page's actual rasterized ink stays inside 14 mm margins**, with small point/pixel rounding tolerance. Unused font ascender space is not mistaken for clipped ink.
- No horizontal overflow or browser storage; immutable reprint after later customer/payments changes; double click and genuinely backend-committed/lost-response retry.

The short invoice, mobile screenshot and **first and last pages of the eight-page invoice were visually inspected**. Inspection found and fixed a mobile caption layout issue; tests now check its height as well. Case-sensitive text inspection was adjusted for CSS-uppercase headings, and rasterized ink was used for margins after PDF font metrics showed unused ascender space. Final focused and full suites pass.

Ignored PDFs/screenshots are under `test-results/invoices-*/phase-six-*.pdf` and `phase-six-*.png`; visual review rasters are `test-results/phase-six-*-inspection.png`. Test PDFs contain fixtures only. Physical printer hardware and non-Chromium engines remain unverified.

## 11. Files created and modified

### Created

| Area | Files |
|---|---|
| Schema | `migrations/0008_invoice_management.sql` |
| Shared | `shared/invoices.ts`, `shared/invoiceValidation.ts` |
| Worker | `worker/routes/invoices.ts`, `worker/services/invoices.ts`, `worker/services/invoice-identity.ts` |
| Frontend | `src/lib/invoices.ts`, `src/pages/InvoicePage.tsx`, `src/components/InvoiceIdentityForm.tsx`, `src/invoice.css` |
| Tests | `test/invoice-fixtures.ts`, `test/invoices.test.ts`, `test/invoice-integrity.test.ts`, `test/invoice-migration.test.ts`, `e2e/invoices.spec.ts` |
| Report | `docs/phase-six.md` |

### Modified

- `worker/index.ts` — authenticated Blaze route registration.
- `src/App.tsx`, `src/components/AppShell.tsx`, `src/pages/PurchaseDetailPage.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/WorkspacePages.tsx` — routing, print selectors, invoice action/minimal business form and readiness scope.
- `test/helpers.ts`, `test/database.test.ts`, `test/payment-migration.test.ts`, `test/README.md` — isolated cleanup ordering/exact guard restoration, eight migrations, monotonic-counter expectation, pinned Phase 5 preservation assertions and test documentation.
- `e2e/auth.spec.ts` — allow the new authenticated settings read in the actual request allowlist; `e2e/purchases.spec.ts` — disambiguate success notice from asynchronous loading status.
- `PROJECT_STATUS.md`, `README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/backup-and-restore.md` — current scope/results and concrete invoice recovery requirements.

Migrations 0001–0007, package/lockfile, original purchase/payment services and private variables are unchanged. Private exports/verification scripts/reports, PDFs, screenshots and build artifacts are excluded from Git staging.

## 12. Actual test results

Successful gates ran via:

```bash
npm run check
npm run test:e2e
npm run typecheck && npm run lint
npm audit
git diff --check
```

| Check | Actual result |
|---|---|
| TypeScript and ESLint | Passed |
| Workerd/D1 | **1,031 tests across 26 files passed**, including all Phase 1–5 regressions |
| Real-backend Chromium | **33 passed**: 27 earlier + 6 invoice cases |
| Focused invoice browser suite | **6 passed** |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities** |
| Tracked/new-file diff whitespace | Passed |

New backend tests cover generation/retrieval/numbering, concurrent same/different purchase requests, repeated submissions, authoritative customer/items/discount/totals/method summaries, unpaid/partial/paid/zero totals, 100 items, real legacy tax, minimal Rx/privacy, cross-customer/missing context, changed customer/shop/payment/read models, audits, transaction rollback, deferred audit/FKs, immutable/no-op/REPLACE behavior, permanent gaps, counter/policy bounds and migration preservation.

Intermediate runs exposed D1 `meta.changes` including the counter trigger's UPDATE, so reservation ownership is now determined by its actual UUID rather than an incorrect one-row count. A forced real-D1 payment/issue scheduling test also reproduced an early request-clock issue timestamp; issuance now stamps the actual database INSERT and the audit copies it. Full Chromium initially exposed the obsolete auth API allowlist and an ambiguous prior purchase success locator; both were updated and the complete suite rerun successfully. Expected nonblocking diagnostics: Blaze missing sourcemaps, >500 kB client bundle, and five deliberate deferred-FK rollback diagnostics. Assertions verify pre-existing test records survive those failures.

## 13. Data-preservation and local migration results

A private SQL export/baseline preceded implementation. Separate in-memory verification databases compare **every original row, column and rowid** plus hashes of migrations 0001–0007 and private variables. Local migration 0008 applied successfully in **16 commands**, with no source/business record rewrite.

| Check | Actual result |
|---|---|
| All original rows/columns/rowids | Preserved |
| Migrations 0001–0007/private variable hashes | Unchanged |
| Repeat local migration | No migrations to apply |
| `PRAGMA foreign_key_check` | Empty |
| `PRAGMA quick_check` | `ok` |
| Migration ledger | All eight migrations recorded |
| Existing owner/customer/prescription | 1 / 1 / 1 |
| Existing purchase/item/payment | 0 / 0 / 0 |
| Existing audits | 4 |
| New invoice/reservation tables | 0 / 0 |

Private artifacts: ignored `backups/phase-six-before-20261005/`, directory 0700 and exports/reports 0600. Populated migration/invoice/print fixtures run only in disposable test databases. No persistent local reset/restore/deletion or test business-data insertion occurred. No remote operation was performed.

## 14. Remaining limitations

- One immutable document per purchase; payment figures are explicitly historical at issue. No corrections/reissue/refunds; later payments remain in purchase history.
- No automated import/regeneration of already-numbered legacy documents or unsupported legacy financial data. Review is required rather than guessed identities/taxes/balances.
- Never-reset sequence only; no financial-year reset or numbering/tax preference UI. Committed unused reservations are gaps and cannot be silently reused. Restore still requires reconciliation of externally printed missing records.
- Required actual shop name/address/contact; GSTIN optional and format-checked only. No automatic tax calculation/legal GST-compliance guarantee.
- At most 100 item snapshots, existing safe integer-paise bounds, 16 KiB create input conventions and finite platform quotas. Invoice JSON copies source records; no current catalog lookup exists.
- Chromium desktop/mobile and native browser PDF rendering verified. Physical printer/driver overrides, other engines/devices and pixel-identical output across future browser/font versions are unverified. The immutable data remains stable.
- Print tests require free Poppler tools on PATH; these were already installed here. Prior remote CPU/Free-plan deployment/recovery gates remain documented.

## 15. Phase 7 confirmation and boundaries

**Phase 7 has NOT started. Stop completely after Phase 6 and await explicit approval.** No reports/CSV exports/analytics, inventory/catalog, R2/images, payment/purchase/credit changes or refunds were implemented. No remote provisioning/migration/deployment, paid service, secret regeneration, `.dev.vars` edit, earlier migration rewrite, existing record deletion, persistent D1 reset or Git commit occurred. No npm dependency was added.

## 16. Exact Git staging commands

Run from the repository root after reviewing the complete diff/new files. These commands have **not** been executed:

```bash
git status --short
git diff
git log --oneline -10
git add \
  PROJECT_STATUS.md README.md docs/architecture.md docs/phase-six.md \
  docs/deployment.md docs/backup-and-restore.md \
  migrations/0008_invoice_management.sql shared/invoices.ts shared/invoiceValidation.ts \
  worker/index.ts worker/routes/invoices.ts worker/services/invoices.ts worker/services/invoice-identity.ts \
  src/App.tsx src/components/AppShell.tsx src/components/InvoiceIdentityForm.tsx \
  src/lib/invoices.ts src/pages/InvoicePage.tsx src/invoice.css \
  src/pages/PurchaseDetailPage.tsx src/pages/SettingsPage.tsx \
  src/pages/DashboardPage.tsx src/pages/WorkspacePages.tsx \
  test/README.md test/helpers.ts test/database.test.ts test/payment-migration.test.ts \
  test/invoice-fixtures.ts test/invoices.test.ts test/invoice-integrity.test.ts test/invoice-migration.test.ts \
  e2e/invoices.spec.ts e2e/auth.spec.ts e2e/purchases.spec.ts
git diff --cached --check
git diff --cached --stat
```

## 17. Exact suggested Git commit command

After reviewing staged content, excluding private data and confirming the checks:

```bash
git commit -m "feat: implement invoice generation and printing"
```

**No staging or commit was executed. Stop at Phase 6.**
