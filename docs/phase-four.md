# Phase 4 — Purchase Management

Implemented and verified locally on **5 October 2026**. Phases 1–3 are committed through `e74aa4f`; Phase 4 is uncommitted. **Phase 5 has not started.**

## 1. Features implemented

- Purchase creation from an existing active customer's profile, with purchase UUID/date, optional notes, created/updated timestamps and 1–100 line items.
- Seven optical categories: spectacle frames, prescription lenses, contact lenses, sunglasses, reading glasses, optical accessories and other products.
- Original item UUID, description, category, whole-number quantity, unit price, fixed whole-line discount and calculated line total snapshots.
- Backend-calculated gross subtotal, combined discounts and grand total; shared exact frontend live preview.
- Optional link to a specific same-customer prescription version; paginated prescription choices retain an explicit older selection across pages.
- Customer-only purchase history with pagination, inclusive date-range and matching-item category filters, plus immutable details and linked prescription navigation.
- Responsive desktop/mobile forms, add/remove items, empty/loading/error/success states, retained values on failures and native unsaved cancel/internal/back/reload guards.
- Synchronous frontend submission locking and stable per-form UUIDs backed by database duplicate protection, including concurrent requests and lost-response retries.
- Atomic purchase/item creation audits and database-enforced immutable/complete historical records.

The inspected working tree contained partial uncommitted Phase 4 backend scaffolding. It was reviewed and completed, with out-of-scope tax/service creation removed and database completeness, filtering, frontend and verification added. No new dependency was needed.

## 2. Files created and modified

### Created

| Area | Files |
|---|---|
| Migration | `migrations/0006_purchase_management.sql` |
| Shared contracts/calculation | `shared/purchases.ts`, `shared/purchaseValidation.ts`, `shared/money.ts` |
| Blaze backend | `worker/routes/purchases.ts`, `worker/services/purchases.ts`, `worker/validators/purchases.ts` |
| Frontend | `src/components/PurchaseHistory.tsx`, `src/lib/purchases.ts`, `src/lib/purchaseValidation.ts`, `src/pages/PurchaseFormPage.tsx`, `src/pages/PurchaseDetailPage.tsx` |
| Backend/D1 tests | `test/purchases.test.ts`, `test/purchase-validation.test.ts`, `test/purchase-integrity.test.ts`, `test/purchase-migration.test.ts` |
| Browser tests | `e2e/purchases.spec.ts` |
| Report | `docs/phase-four.md` |

The existing money helper implementation moved to `shared/money.ts`; its established Worker import path remains a re-export.

### Modified

- `worker/index.ts`, `worker/lib/money.ts`.
- `src/App.tsx`, `src/pages/CustomerProfilePage.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/WorkspacePages.tsx`.
- `test/helpers.ts`, `test/database.test.ts`, `test/customers.test.ts`, `test/prescription-migration.test.ts`, `test/README.md`.
- `e2e/customers.spec.ts` — replaces the obsolete unavailable-purchases assertion with real empty history/add controls.
- `PROJECT_STATUS.md`, `README.md`, `docs/architecture.md`.

Migrations 0001–0005, package manifests/lockfile, authentication implementation and private variables are unchanged. Ignored private preservation exports/reports and browser screenshots are local artifacts, not staging targets.

## 3. Database schema and migration

The foundation already had suitable `purchases(id)` and `purchase_items(id)` tables, with UUID text keys, integer-paise fields, dates, timestamps and downstream relationships. Phase 4 extends those tables; it does not duplicate them or rebuild historical data.

Migration **`0006_purchase_management.sql`** adds:

| Table | New field | Purpose |
|---|---|---|
| purchases | `client_request_id TEXT` | Stable customer-scoped submission UUID |
| purchases | `item_count INTEGER` | Required for new inserts; integer 1–100 |
| purchases | `creation_audit_id TEXT` | Deferred restrictive FK to immutable `audit_logs(id)` |
| purchase_items | `snapshot_position INTEGER` | Required for new item snapshots; integer 0–99 |

Indexes:
- Unique `(customer_id, client_request_id)` where a submission UUID exists.
- Unique purchase creation audit anchor.
- Unique `(purchase_id, snapshot_position)` where position exists.
- Customer/purchase-date expression/created-time/UUID history ordering, with a legacy created-date fallback.
- Purchase/item sort-order/UUID access.

Existing `customer_id → customers(uuid)` and `prescription_id → prescriptions(id)` FKs remain. Purchase/item prescription insert guards enforce same-customer references independently of API checks. Purchase headers require a customer for all future SQL inserts. API input/output uses `uuid`, `customer_uuid`, `prescription_uuid`, and item `purchase_uuid` aliases.

### Preventing empty and partial purchases

A new header requires a positive item count and its own new, unique `creation_audit_id`. This FK is **DEFERRABLE INITIALLY DEFERRED** and is checked at D1 batch commit. The audit must be inserted after the items; its insert trigger checks the owning purchase, expected item count, summed gross subtotal, taxes and discounts. A missing item, empty set, forged subtotal, wrong audit entity or skipped audit fails the transaction. Referencing a pre-existing audit is rejected. A successful creation audit seals the set against later appends.

This is stronger than an API-only nonempty check or a sealing trigger that a SQL writer could skip. It uses the existing audit infrastructure and adds no staging/payment/invoice tables.

### Atomic write and query budget

One D1 `batch()` executes **five parameterized statements**:
1. Header insert with active customer and optional same-customer Rx checks inside the transaction.
2. All item snapshots via one bound JSON array and SQLite `json_each()`.
3. Creation audit, validating and sealing the full item set.
4. Persisted header response.
5. Persisted item response.

The statement count is constant for 1–100 items. This avoids one-query-per-item growth and fits the Free-plan per-invocation query budget. Numbers in the bound JSON are already backend-validated safe integers. No client subtotal/line/grand total is accepted. Later-item/audit failures roll the whole batch back, and a racing customer archive cannot leave a phantom purchase or audit.

### Legacy preservation and immutability

Existing rows retain every original field and gain NULL only in the new columns. Tables, original columns, UUIDs, rowids, timestamps, legacy invoice fields and linked clinical records are preserved. Legacy nullable customer/date/custom-category data is not silently normalized or discarded.

All purchase and item UPDATE/DELETE operations, including no-ops, are rejected. Primary-key replacement and unique invoice-number reuse are insert-guarded because SQLite REPLACE can bypass DELETE triggers. Sealed item sets cannot accept new rows. Legacy unnumbered purchases also become immutable. There is no editing/deletion API.

New records use the old internal `draft` status to satisfy the foundation's invoice-oriented constraints; the UI presents permanent purchase records and offers no editable draft, invoice or payment workflow.

## 4. API endpoints

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/customers/:customerUuid/purchases` | Customer purchase list/history with snapshot-consistent pagination |
| POST | `/api/customers/:customerUuid/purchases` | Atomic purchase/items/audit, HTTP 201 |
| GET | `/api/customers/:customerUuid/purchases/:purchaseUuid` | Immutable purchase and item snapshots |

List/history is one endpoint. Query parameters: `page` (default 1, max 10,000), `pageSize` (default 20, max 50), `dateFrom`, `dateTo` (inclusive real calendar dates), and `category` (one of seven optical categories). Ordering: purchase date descending, created time descending, UUID ascending. Category filtering matches purchases containing at least one item in that category and counts each purchase once. Unknown/duplicate parameters, malformed encodings and reversed/invalid date ranges are rejected.

Example create body:

```json
{
  "client_request_id": "fc43c62a-7601-44c3-9c0e-9bca0c168e32",
  "purchase_date": "2026-04-08",
  "prescription_uuid": null,
  "notes": "Optional fitting note",
  "order_discount": "1.00",
  "items": [
    {
      "description": "Original frame",
      "product_category": "spectacle_frames",
      "quantity": 2,
      "unit_price": "125.50",
      "discount": "0.50"
    },
    {
      "description": "Original lenses",
      "product_category": "prescription_lenses",
      "quantity": 3,
      "unit_price": "0.10",
      "discount": "0.01"
    }
  ]
}
```

The response uses the existing success/data/message/meta envelope, includes backend-calculated integer-paise totals and both timestamps, and excludes internal submission/audit/actor columns. Details and item queries bind both customer/purchase UUIDs. Missing/cross-customer Rx and mismatched purchase context produce safe 404; archived customer creation and duplicate keys produce safe 409. Auth, exact Origin/CSRF, sessions, existing throttling, 16 KiB JSON limit, no-store/security headers and safe exception logging remain active. PATCH/DELETE purchase routes do not exist; future APIs remain unavailable.

## 5. Monetary calculation strategy

- Currency: INR, stored/returned as integer paise.
- Unit prices and discounts enter as nonnegative decimal **strings** with at most two fractional digits. Excess precision, exponent notation, commas, signed/negative amounts and numeric JSON amounts are rejected, not rounded/coerced.
- `shared/money.ts` parses decimal text with BigInt. Arithmetic intermediates use BigInt; results must be nonnegative safe integers, at most **9,007,199,254,740,991 paise**.
- Whole-number quantity: 1–100,000. Zero unit price and fully discounted purchases are valid; discounts cannot exceed gross value.
- A line discount is one fixed amount for the entire line, not a per-unit discount or percentage.

```text
line gross    = quantity × unit price paise
line total    = line gross − line discount paise
subtotal      = sum(line gross)
discount      = sum(line discount) + purchase discount
grand total   = subtotal − discount
```

For the example above: line totals **₹250.50** and **₹0.29**, subtotal **₹251.30**, combined discount **₹1.51**, grand total **₹249.79**. One-paise tests and safe-range boundaries verify exactness. The browser and backend reuse the same calculation; details always display persisted server results. New purchases use zero tax and no tax configuration. Preserved legacy tax, if present, remains part of the stored total and is labeled as legacy in details.

## 6. Prescription linking

A link is optional. A supplied UUID must resolve to a prescription owned by the selected customer; both backend and SQL guards prevent cross-customer linking. Any explicit existing version can be selected, including older revisions. There is no automatic latest-version choice, clinical inference, or reference rewriting. An updated/new prescription creates another record while the purchase continues to reference its originally selected UUID. Archived customers retain readable purchase/Rx history.

## 7. Audit and historical record strategy

One `purchase`/`create` audit contains the owner/request identity, purchase/customer/prescription UUIDs, date, financial totals, item count, and an ordered array of exact item UUID/description/category/quantity/unit-price/discount/line-total/position snapshots. It is derived from persisted rows inside the same transaction. Purchase notes, customer contacts and clinical measurements/prescriber details are omitted. Unexpected errors log only event/request/category metadata.

Purchase and item tables are permanent immutable sources of truth. No catalog, description or future price reference can overwrite an existing row. **Corrections are not implemented:** a future approved append-only correction design must preserve originals. Directly updating a legacy draft or assigning an invoice number is now blocked, so later invoice work must be designed around these immutable records rather than silently modifying them.

## 8. Actual verification results

Final implementation command:

```bash
npm run check && npm run test:e2e
```

| Check | Actual result |
|---|---|
| TypeScript (`tsc -b`) | Passed |
| ESLint | Passed |
| Workerd/D1 backend tests | **901 passed, 19 files** |
| Chromium real Worker/D1 browser tests | **19 passed**: 11 earlier scenarios + 8 Phase 4 desktop/mobile cases |
| Production build | Passed |
| `git diff --check` | Passed |
| `npm audit` | **0 vulnerabilities** |
| Migration on existing local D1 | 0006 applied, **23 commands** |
| Repeat local migration | No migrations to apply |
| Preservation checks | All original rows/columns intact, earlier migrations/private variables unchanged, foreign keys clean |
| Live local D1 integrity | `PRAGMA foreign_key_check` empty; `PRAGMA quick_check` returned `ok`; all six migrations recorded |

The new backend tests cover creation/multiple/max-100 items, empty/partial/unaudited SQL rejection, invalid customers/Rx and cross-customer reads/writes, strict quantity/price/discount/precision/overflow, correct totals, zero totals, later-item/audit rollback, duplicate/concurrent requests, history pagination/filters/snapshots, unauthorized/security boundaries, audits, all-column/no-op immutability and replacement/append integrity. Foundation test fixtures now create complete audited purchase sets. Prescription migration tests are pinned to 0001–0005 so the Phase 3 preservation assertions remain exact. All Phase 1–3 authentication/customer/prescription regression suites passed.

Browser tests use real local API/D1, desktop **1440×960** and mobile **390×844**. They cover opening profiles, creation, adding/removing/empty items, category selection, optional/exact/older paged Rx selection, saved totals/details/reload, archived read-only history, dirty cancel/internal/back/reload, >20 purchases with 20/50 paging, date/category filters, synchronous double-submit and genuine backend-committed/lost-response duplicate rejection. The lost-response test fetches the actual backend response then drops only that response; no fake successful business response is substituted. Screenshots are in ignored `test-results/phase-four-*.png`.

An intermediate browser run caught duplicate sibling React keys in the profile and an uncontrolled paginated Rx selection. Both were fixed; the final complete suite passed. Build/test diagnostics retain the existing Blaze missing-sourcemap messages and >500 kB client bundle warning. Two deliberately incomplete deferred-FK SQL transactions emit expected workerd/Miniflare rollback diagnostics; assertions verify the old owner/customer/audit data survives, and the suite exits successfully.

### Existing local data preservation

An ignored private SQL export was taken before applying 0006. Before/after exports were loaded into separate in-memory verification databases and every original table/column/row was hash-compared. Private variable and migration 0001–0005 hashes also match. Current preserved counts: **1 owner, 1 customer, 1 prescription, 0 purchases, 0 items, 0 payments**. The prescription added since the Phase 3 snapshot was retained. Private exports/hashes/report are under `backups/phase-four-before-20261005T110000Z/` (directory mode 0700, files 0600). No existing local DB was reset/restored and no test purchase was added to it. Populated legacy migration tests run only against disposable D1.

## 9. Remaining limitations and boundaries

- No purchase edits/deletes/corrections; entry-error correction requires a later approved history-preserving design.
- Maximum 100 items, quantity 100,000, 16 KiB request, 50 records/page and 10,000 pages. Long descriptions may hit the byte cap before the item cap. Date filters can narrow larger histories.
- Duplicate protection depends on preserving the customer/submission UUID. Independent forms/new keys are intentionally not content-deduplicated. Drafts/keys are memory-only and do not survive reload/discard; use history to confirm uncertain submissions.
- Free-text product snapshots only; no catalog/inventory/stock/image behavior. Prescription selection is explicit and makes no clinical approval claim.
- Chromium desktop/mobile were verified; other browser engines/devices remain unverified. Existing deployment/Free-plan CPU and shared-quota limitations remain in the earlier reports.

No payment recording, outstanding balances, credit allocation, invoice generation, inventory, R2/image upload or Phase 5 functionality was implemented. No earlier migrations, secrets or owner/customer/prescription data were changed/deleted. No dependencies, remote resources/migrations/deployments, paid services or automatic commits were introduced.

## 10. Exact Git staging and commit commands

Run from the repository root after reviewing the diff. Staging and commit commands were **not executed** by the agent:

```bash
git status --short
git diff
git log --oneline -10
git add \
  PROJECT_STATUS.md README.md docs/architecture.md docs/phase-four.md \
  migrations/0006_purchase_management.sql \
  shared/money.ts shared/purchases.ts shared/purchaseValidation.ts \
  worker/index.ts worker/lib/money.ts worker/routes/purchases.ts \
  worker/services/purchases.ts worker/validators/purchases.ts \
  src/App.tsx src/components/PurchaseHistory.tsx \
  src/lib/purchases.ts src/lib/purchaseValidation.ts \
  src/pages/CustomerProfilePage.tsx src/pages/DashboardPage.tsx \
  src/pages/WorkspacePages.tsx src/pages/PurchaseFormPage.tsx src/pages/PurchaseDetailPage.tsx \
  test/README.md test/helpers.ts test/database.test.ts test/customers.test.ts \
  test/prescription-migration.test.ts test/purchases.test.ts \
  test/purchase-validation.test.ts test/purchase-integrity.test.ts test/purchase-migration.test.ts \
  e2e/customers.spec.ts e2e/purchases.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat: implement purchase management module"
```

**Stop at Phase 4. Wait for explicit approval before proceeding to Phase 5.**
