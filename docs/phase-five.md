# Phase 5 — Payments & Credit Management

Implemented and verified locally on **5 October 2026**. Phase 4 is committed as `cd0e82c feat: implement purchase management module`; Phase 5 began from a clean working tree and remains uncommitted. **Stop at Phase 5; Phase 6 has not started.**

## 1. Features implemented

- Record positive Cash, UPI or Card payments against an existing customer's purchase, with UUID, received/created times and optional reference/note.
- Multiple partial payments and exact final settlement, each retained as an individual immutable record.
- Purchase total, amount paid, outstanding and Unpaid/Partially paid/Paid status derived by the backend from persisted records.
- Customer total outstanding credit across all purchases, independent of visible history pagination/filters.
- Chronological paginated payment history and customer/purchase-scoped individual API reads.
- Responsive payment form, inline validation, success/error feedback, retained drafts, authoritative stale-balance refresh and dirty cancel/navigation/back/reload protection.
- Atomic creation audits, database-enforced concurrent overpayment prevention and customer-scoped duplicate protection, including lost-response full-payment retries.
- Existing authentication, customer, prescription and purchase behavior retained and regression-tested.

## 2. Files created and modified

### Created

| Area | Files |
|---|---|
| Migration | `migrations/0007_payment_management.sql` |
| Shared contracts/validation | `shared/payments.ts`, `shared/paymentValidation.ts`, `shared/time.ts` |
| Blaze/backend | `worker/routes/payments.ts`, `worker/validators/payments.ts`, `worker/services/payments.ts`, `worker/services/payment-balances.ts`, `worker/lib/query.ts` |
| Frontend | `src/components/CustomerCredit.tsx`, `src/components/PaymentSummary.tsx`, `src/components/PaymentHistory.tsx`, `src/lib/payments.ts`, `src/lib/paymentValidation.ts`, `src/pages/PaymentFormPage.tsx` |
| Tests | `test/payment-fixtures.ts`, `test/payments.test.ts`, `test/payment-validation.test.ts`, `test/payment-integrity.test.ts`, `test/payment-migration.test.ts`, `e2e/payments.spec.ts` |
| Report | `docs/phase-five.md` |

### Modified

- `shared/purchaseValidation.ts`, `shared/purchases.ts` — export established decimal-money schema; expose derived payment fields on purchase responses.
- `worker/index.ts`, `worker/lib/time.ts`, `worker/validators/purchases.ts`, `worker/services/purchases.ts` — route registration, shared helper reuse and read-only payment summaries.
- `src/App.tsx`, `src/components/PurchaseHistory.tsx`, `src/pages/CustomerProfilePage.tsx`, `src/pages/PurchaseDetailPage.tsx`, `src/pages/PurchaseFormPage.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/WorkspacePages.tsx` — route, balances/history/statuses, query invalidation and readiness navigation.
- `test/helpers.ts`, `test/database.test.ts`, `test/purchase-migration.test.ts`, `test/README.md` — isolated immutable-ledger cleanup, seven-migration contract, pinned historical migration assertions and coverage documentation.
- `PROJECT_STATUS.md`, `README.md`, `docs/architecture.md` — current Phase 5 handoff.

No dependency or package/lockfile changes. Migrations 0001–0006 and private variables are unchanged. Ignored exports, verification reports and screenshots are local artifacts, not staging targets. Historical phase reports remain historical checkpoints.

## 3. Database schema and migration

The foundation already contains `payments(id)` with purchase/customer identity, integer-paise amount, method/status, received/settled time, reference/note, actor and timestamps. Migration **`0007_payment_management.sql`** extends that ledger without rebuilding or duplicating it.

| New field | Purpose |
|---|---|
| `client_request_id TEXT` | Stable customer-scoped submission UUID |
| `creation_audit_id TEXT` | Deferred restrictive FK to existing immutable `audit_logs(id)` |

Both are nullable for preserved legacy records; new inserts must provide them. No historical audit is invented.

Indexes: unique customer/submission and creation audit, ordered purchase/received/created/UUID history, and partial covering purchase/amount index for settled, nondeleted payments. The new `purchase_payment_balances` view is a derived read model, not a stored balance cache.

INSERT guards enforce ownership, active customer, payable INR purchase, positive safe integer amount, method, settled/nondeleted state, submission/audit anchor and valid date/current outstanding. UPDATE/DELETE and primary-key/submission-key replacement are blocked, including no-op edits. A matching payment-create audit is required at batch commit. Original payment-customer/FK and purchase/item guards remain active.

The legacy `payment_reversals` table and every old row are preserved. New reversal insertion, editing and deletion are disabled; no refund workflow is enabled.

## 4. API endpoints

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/customers/:customerUuid/credit-summary` | Customer UUID and total outstanding paise |
| GET | `/api/customers/:customerUuid/purchases/:purchaseUuid/payments` | Individual history, pagination and authoritative purchase summary |
| POST | `/api/customers/:customerUuid/purchases/:purchaseUuid/payments` | Payment plus derived purchase summary; HTTP 201 |
| GET | `/api/customers/:customerUuid/purchases/:purchaseUuid/payments/:paymentUuid` | One immutable record bound to the full hierarchy |

History accepts only `page` (default 1, maximum 10,000) and `pageSize` (default 20, maximum 50). Unknown/duplicate parameters and malformed encoding are rejected. Sorting is received time, created time, UUID ascending. History/count/summary execute in one D1 batch snapshot. Missing or mismatched context returns safe 404.

Example request:

```json
{
  "client_request_id": "fc43c62a-7601-44c3-9c0e-9bca0c168e32",
  "amount": "1500.00",
  "payment_method": "upi",
  "received_at": "2026-04-09T12:30:00.000Z",
  "reference": "Optional transaction reference",
  "notes": "Optional payment note"
}
```

`received_at` may be omitted for backend current time; reference/note may be omitted or null. The existing success/data/message/meta envelope is retained. Identity JSON uses UUID aliases over existing schema columns. No internal submission/audit/actor fields are exposed; no update/delete/refund endpoint exists. Existing purchase create/list/detail responses additionally expose `amount_paid_paise`, `outstanding_paise`, `payment_status`.

## 5. Monetary precision and bounds

- INR input is decimal rupee **text**, not JSON numbers. At most two decimal places; no exponent notation, comma formatting, signed negatives or rounding/coercion.
- Payment amount must be greater than zero. One paise (`"0.01"`) is valid.
- Reuse `shared/money.ts` BigInt parsing/arithmetic and the established purchase money schema. No second currency encoding or floating arithmetic is introduced.
- Stored/returned amounts are safe integer paise, at most **9,007,199,254,740,991 paise**. The maximum rupee input is `"90071992547409.91"`.
- Database guards independently reject fractional, nonpositive or out-of-range amounts even when bypassing HTTP validation.

## 6. Authoritative balance calculation

```text
paid        = SUM(payment amount where status = settled and deleted_at IS NULL)
outstanding = immutable stored purchase grand total − paid
```

The view and shared read services are used by purchase create/list/detail, payment create/history and customer credit. Client totals/statuses/outstanding are neither accepted nor trusted. No purchase header, item, original timestamp or monetary snapshot changes when a payment is recorded. A successful response is read from persisted rows inside the creation batch, not assembled from client guesses.

Legacy pending/voided/refunded/deleted payments do not reduce outstanding. Legacy method/status text remains readable. Unsupported posted reversals or inconsistent legacy money return `FINANCIAL_DATA_INVALID` before presenting an invented balance or recording more payments; there is no clamping, rounding or silent repair.

## 7. Customer credit aggregation

Credit is **the amount the customer owes for purchases**, not wallet funds, transferable credit or lending. The credit endpoint sums outstanding across the customer's entire purchase set; filters/pagination on the profile do not affect it. Customers with no purchases return zero. Archived customer credit remains readable.

SQL aggregates integer billion-paise quotient/remainder components as text; BigInt reconstructs the exact total before safe-integer output validation. This avoids a floating `SUM()` and silent JavaScript rounding for large aggregates. An unrepresentable total returns `CREDIT_TOTAL_OUT_OF_RANGE` rather than an inaccurate number. Inconsistent/unsupported legacy records instead return `FINANCIAL_DATA_INVALID`.

## 8. Payment status rules

| Persisted state | Derived status |
|---|---|
| Paid equals total | `paid` / Paid |
| Paid is zero and total is positive | `unpaid` / Unpaid |
| Paid is positive and below total | `partially_paid` / Partially paid |

**Zero-total purchases are paid**, because equality is tested first. Positive new payments cannot be recorded against zero outstanding. The old invoice-oriented `purchases.status` is preserved; the new `payment_status` is derived independently and never written into the purchase row.

## 9. Concurrent overpayment prevention

Preliminary reads establish context only. The amount/outstanding comparison is enforced by the payment INSERT trigger **inside SQLite/D1's serialized write transaction**. It sees earlier committed payments and earlier statements in the same batch. Two requests that both saw the same old balance cannot both overpay it.

Tests force two genuine preliminary reads to finish before releasing real D1 batches. Racing ₹700 + ₹700 on ₹1,000, or two independent full payments, have one winner and safe `PAYMENT_EXCEEDS_OUTSTANDING` for the loser. Complementary ₹700 + ₹300 both succeed. A racing archive also fails inside the insert and produces no phantom payment/audit. The scheduling adapter changes timing only, never SQL/results/constraints.

## 10. Duplicate submission and lost-response handling

Each form creates one in-memory UUID retained across edits and failed/lost-response retries. A synchronous lock prevents two submit handlers from dispatching overlapping writes. The database unique customer/submission index and INSERT guard protect against concurrent/API-level duplication and key reuse for another purchase of the same customer.

Duplicates are rejected with **409 `PAYMENT_DUPLICATE`**, not replayed success. The duplicate check runs before overpayment/eligibility checks, so a retry after exact full settlement still identifies the recorded submission. The UI refreshes persisted balances/history, disables another submission and links to history. No additional payment or audit is committed.

Separate forms/new UUIDs are not content-deduplicated. Draft/key state is memory-only; after reload/discard, confirm uncertain saves in history before opening another form.

## 11. Payment dates and timestamps

- API received time is a real canonical UTC millisecond timestamp, years 0001–9999; omitted time defaults to backend now.
- Reject future time and time before the purchase date's **UTC midnight**, with the existing created-date fallback for legacy purchases.
- Both backend validation and the in-transaction SQL guard enforce date rules.
- The browser displays an explicit device-local minute-precision datetime and converts it to UTC. It is not a Phase 6 Indian-business-date reporting policy.
- Reference is optional, at most 200 characters; note at most 2,000, with established control-character/line-break rules.

## 12. Atomic creation and audit strategy

Four prepared statements run in one D1 `batch()`:

1. Guarded immutable payment insert.
2. Payment creation audit derived from the persisted payment.
3. Persisted individual payment response.
4. Derived purchase balance/status response.

The audit anchor is deferred/restrictive and unique. A pre-existing audit cannot anchor a new payment; audit entity/action/owner/created time must match. Skipping the audit fails at commit. Audit or later-statement failure rolls back both rows and leaves the submission key available for a real retry.

One `payment`/`create` event stores payment/purchase/customer UUIDs, amount/method, received/created times and owner/request identity. Reference/note, contact/clinical data and credentials are omitted. There are no payment edit/delete audits because those workflows do not exist. Existing minimal error logging and immutable audit guards are retained.

## 13. Frontend integration

- Customer profile: total outstanding card, purchase paid/outstanding figures and status badges.
- Purchase details: derived summary, chronological paginated individual history, conditional **Record Payment**, immutable purchase snapshots.
- `/customers/:uuid/purchases/:purchaseUuid/payments/new`: React Hook Form/Zod form, outstanding default amount, Cash/UPI/Card, local time, optional reference/note.
- `/payments`: guides the owner to an existing customer/purchase. Dashboard describes readiness without financial metrics/charts.
- Loading/error/empty/success states, inline field errors and accessible dirty confirmation/focus match the existing application.
- Success invalidates customer purchase/payment/credit queries. Duplicate/overpay errors refresh authoritative balance while retaining feedback and draft; overpay returns focus to the amount.
- Archived customers stay readable but must be restored before new payments. Fully paid purchases do not offer new payments. Cancel/internal navigation/back/reload guards protect dirty or pending forms.
- No payment/draft/auth data is persisted in localStorage/sessionStorage.

## 14. Validation and security continuity

All new endpoints use Blaze and the existing central administrator/session boundary. Mutations require exact Origin and session-bound CSRF; no alternate authorization or framework is added. UUID hierarchy, JSON media/16 KiB limits, strict unknown-field rejection, prepared SQL, no-store/security headers and safe response/error conventions continue unchanged.

Forged total/paid/outstanding/status, customer/purchase reassignment, invoice/refund fields and arbitrary methods are rejected. Missing/cross-customer/purchase/payment records return safe 404. Archive/nonpayable/overpay/duplicate/inconsistent-financial conflicts are safe errors, without leaked SQL/stack/contact/clinical details. No destructive route exists.

## 15. Actual automated verification

Final implementation command:

```bash
npm run check && npm run test:e2e
```

| Check | Actual result |
|---|---|
| TypeScript (`tsc -b`) | Passed |
| ESLint | Passed |
| Workerd/D1 tests | **1,004 passed across 23 files**, including all Phase 1–4 regressions |
| Focused Phase 5 backend files | **103 passed across 4 files** |
| Real Worker/D1 Chromium browser tests | **27 passed**: 19 earlier + 8 payment cases |
| Focused payment browser suite | **8 passed** |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities** |
| Tracked/new-file diff whitespace checks | Passed |

Backend coverage includes lifecycle/status/credit, strict money/time/method/schema/security, hierarchy, paginated snapshots, forced concurrent overpay/final/complementary/duplicate writes, archive races, every-column/no-op immutability/REPLACE, direct SQL limits, wrong/pre-existing/skipped audits, audit/later-statement rollback, maximum-safe amount/aggregate overflow, indexed lookup and populated legacy preservation/fail-closed behavior.

Browser cases use the real backend at desktop **1440×960** and mobile **390×844**: Cash→UPI→Card partial-to-full settlement, unchanged original purchases, customer aggregate/status refresh, synchronous double submit, validation/dirty guards, real independent payment making a form stale, retained input/error focus, backend-committed/lost-response final-payment retry, >20 chronological history/pagination and archived readability. Lost-response interception fetches the actual backend response and discards only delivery; no fake successful business result is used. Screenshots are ignored `test-results/phase-five-*.png`.

The initial browser run caught an ambiguous Paid assertion while navigating from a multi-purchase profile. Waiting for the purchase-detail heading fixed the test timing; the focused and full suites passed. Nonblocking diagnostics remain the existing Blaze missing sourcemaps and >500 kB client chunk warning. Three deliberately skipped-audit deferred-FK tests emit expected workerd/Miniflare rollback diagnostics; assertions verify pre-existing test records survive.

## 16. Local migration and preservation results

Before implementation, a private local export and baseline captured every existing table's original columns/rows/rowids and hashes of migrations 0001–0006/private variables. After verification, `npm run db:migrate:local` applied 0007 successfully: **15 commands**. A second private local export was compared to the baseline; **every original row/column/rowid and all file hashes match**.

| Local check | Actual result |
|---|---|
| Repeat local migration | No migrations to apply |
| `PRAGMA foreign_key_check` | Empty |
| `PRAGMA quick_check` | `ok` |
| Migration ledger | All seven migrations recorded |
| Preserved owner/customer/prescription | 1 / 1 / 1 |
| Preserved purchase/item/payment | 0 / 0 / 0 |
| Preserved audit records | 4 |

Ignored private artifacts are under `backups/phase-five-before-20261005/` (directory 0700, exports/reports 0600). Comparison used separate in-memory verification databases; persistent local D1 was never reset/restored, and no test payment/purchase was inserted there. Populated payment/reversal migration scenarios run only in disposable test databases. No remote database was accessed or migrated.

## 17. Remaining limitations and phase boundaries

- Payments/purchases cannot be edited/deleted, including entry mistakes. Refunds, reversals and corrections need a separately approved append-only design; posted legacy reversals/inconsistent finances intentionally require review rather than silent remediation.
- Customer debt only: no wallet, customer-level advance allocation, transferable credit or lending.
- INR safe-integer amounts/aggregate, at most 50 history records/page, 10,000 pages, 16 KiB mutation JSON, 200 reference and 2,000 note characters. Customer aggregation reads all purchases, not just a page; finite platform quotas still apply.
- Stable submission UUIDs protect one customer/key, not independently keyed identical content. Unsaved state is memory-only.
- Payment received-time uses UTC purchase boundaries and device-local form display; business-date reports are outside this phase.
- Chromium desktop/mobile verified; other engines/devices remain unverified. Prior remote CPU/Free-plan quota/deployment constraints remain documented.

No invoice generation/numbering/printing, refunds, wallets/lending, inventory, R2/images, dashboard metrics/charts, reports/exports or Phase 6 functionality was added. No dependency, remote resource/migration/deployment, paid service, secret regeneration/private-variable edit, earlier-migration rewrite, existing-record deletion, persistent local reset or Git commit occurred during Phase 5.

## 18. Exact Git staging and commit commands

Run from the repository root after reviewing the complete diff, including new files. These commands were **not executed** by the agent; private exports, variables, build/test artifacts and historical phase reports are excluded from the explicit staging list.

```bash
git status --short
git diff
git log --oneline -10
git add \
  PROJECT_STATUS.md README.md docs/architecture.md docs/phase-five.md \
  migrations/0007_payment_management.sql \
  shared/payments.ts shared/paymentValidation.ts shared/time.ts \
  shared/purchases.ts shared/purchaseValidation.ts \
  worker/index.ts worker/lib/time.ts worker/lib/query.ts \
  worker/routes/payments.ts worker/validators/payments.ts worker/validators/purchases.ts \
  worker/services/payments.ts worker/services/payment-balances.ts worker/services/purchases.ts \
  src/App.tsx src/components/CustomerCredit.tsx src/components/PaymentSummary.tsx \
  src/components/PaymentHistory.tsx src/components/PurchaseHistory.tsx \
  src/lib/payments.ts src/lib/paymentValidation.ts src/pages/PaymentFormPage.tsx \
  src/pages/CustomerProfilePage.tsx src/pages/PurchaseDetailPage.tsx src/pages/PurchaseFormPage.tsx \
  src/pages/DashboardPage.tsx src/pages/WorkspacePages.tsx \
  test/README.md test/helpers.ts test/database.test.ts test/purchase-migration.test.ts \
  test/payment-fixtures.ts test/payments.test.ts test/payment-validation.test.ts \
  test/payment-integrity.test.ts test/payment-migration.test.ts e2e/payments.spec.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat: implement payments and credit management"
```

**Stop at Phase 5. Wait for explicit approval before proceeding to Phase 6.**
