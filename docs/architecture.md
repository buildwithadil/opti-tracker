# OptiDesk architecture and phase boundaries

## Repository assessment

The requested directory was initially empty apart from harness metadata; it was not then a Git repository. Phases 1–7 are committed through `ea6f27e`. Phase 8 began from that clean checkpoint and completes local final acceptance/security/recovery review; its changes are uncommitted. Original local owner/customer/clinical/financial/invoice/audit/shop data remain identical to the Phase 8 baseline, including all retained Phase 7 live activity. Production bindings are not configured. No remote account inspection, migration, provisioning, deployment or restore has been performed.

## Deployment unit

One React SPA and one TypeScript Cloudflare Worker deploy together through Workers Static Assets. `/api` and `/api/*` always execute Worker code; other navigation uses SPA asset fallback. Only the public app shell is static. Customer, prescription, invoice, and payment data require authenticated API calls and must never be embedded in static files or a service-worker cache.

- React, React Router, TanStack Query, React Hook Form, Zod, Tailwind, Lucide, locally owned shadcn-style UI primitives.
- Blaze `blazefw@1.0.2` for routing. No alternative backend framework.
- Direct D1 prepared SQL; no ORM, R2, KV, paid API, or external database.
- Vite's Cloudflare integration for local workerd/D1 and one build/deploy unit.
- Explicit versioned migrations and local workerd integration tests.

```text
src/                    React application
  components/ui/        Locally owned UI primitives
  pages/                Phase-scoped screens
  lib/                  In-memory API client, formatting, navigation
worker/
  index.ts              Central authentication/security/error boundary
  routes/               Blaze auth and customer/clinical/financial/invoice/report routes
  validators/           Strict backend path/query schemas
  services/             Atomic audits, immutable snapshots/numbering, derived credit and SQL reports
  lib/                  Web Crypto, HTTP, D1 and money helpers
shared/                 Contracts/validation, exact money, UTC and IST report dates
migrations/             Append-only SQL migration files
public/_headers         Security headers for assets served without the Worker
test/                   Workerd/D1 integration and utility tests
e2e/                    Browser tests against real local API and D1
maintenance/            Offline trusted SQL recovery preparation; not runtime API code
docs/                   Architecture, phase reports, deployment/recovery runbooks
```

## Data relationships

Existing 0001/0002 migrations created the business foundation; 0003 adds integrity corrections. Phase 2 appends 0004 for canonical customers, Phase 3 appends 0005 for immutable prescription lineage, Phase 4 appends 0006 for complete immutable purchase snapshots and Phase 5 appends 0007 for immutable payments/derived balances. Phase 6 appends 0008 for permanent number reservations and immutable invoices. Phase 7 appends index-only 0009 for shop-wide report date lookups. No original table is rebuilt/rewritten by 0009; previously applied migrations remain unchanged.

- `admin_users` has one enforced singleton owner. The initial schema contains a legacy role column, but migrations restrict it to owner and neither UI nor API implements roles/staff.
- Owner → many `sessions`. Only HMAC token hashes are stored. The cookie token is 256 random bits. Twelve-hour absolute expiration; logout revokes the current session, password change revokes every active session.
- One `shop_settings` row stores identity, optional GSTIN, invoice format/counter, INR currency, default tax configuration, and footer.
- Customer → many prescriptions and purchases. Customer identity is `uuid`; existing child `customer_id` foreign keys now reference `customers(uuid)`. The partial index on canonical `normalized_phone` applies only where `archived_at IS NULL`. Equivalent Indian mobile inputs cannot bypass active uniqueness, and archived numbers can be reused. Customers are never automatically merged or permanently deleted.
- Customer → multiple prescription roots and immutable linked versions. Existing `prescriptions(id)` stays stable, with `customer_id` referencing `customers(uuid)`; JSON exposes UUID aliases. Each chain has one current head, not one clinically approved prescription per customer.
- Purchase → one or more immutable line items; optional reference to a specific immutable prescription version of the same customer; many immutable payments. Purchase totals and original timestamps never change when a payment is recorded.
- Payment → one purchase/customer and one creation audit for new records. Legacy reversal events remain preserved, but new reversal/refund operations are disabled and posted legacy reversals require review before a balance is shown.
- Purchase → at most one Phase 6 invoice, with immutable minimal customer/shop/item/tax/financial/payment-at-issue snapshots and an audited number reservation. No invoice fields are assigned onto the immutable purchase header.
- Audit events are append-only with update/delete guards.
- `auth_rate_limits` holds HMAC-scoped short-lived throttle counters.

Financial values use integer paise; legacy tax rates use integer basis points. Financial calculations use safe integers/BigInt intermediates, not decimal floating-point arithmetic. Phase 4 computes gross subtotals/discounts/grand totals without tax calculation; Phase 5 derives live payment status/outstanding from settled, nondeleted payments. Phase 6 copies those persisted facts into an immutable invoice, never recalculating or changing the purchase. Tax/HSN/GST values are displayed only when actually recorded/configured; no tax engine or legal-compliance claim is introduced. Refund/reversal semantics remain disabled; unsupported posted legacy reversals fail closed.

## Phase 1 security

Setup is secret-gated with `SETUP_TOKEN`, disabled when absent, and permanently blocked once any owner record exists. Owner + settings + audit + session are committed in one D1 batch. A database singleton constraint resolves concurrent bootstrap races.

Passwords: native Web Crypto PBKDF2-SHA-256, 600,000 iterations, random 16-byte salt, 256-bit output, self-describing encoded hash. The workerd runtime has been checked for support. Remote CPU usage on the Workers Free plan must still be measured before production approval; local wall-clock timing is not a proof of CPU-budget compliance. The work factor must not be silently lowered to fit the free limit.

HTTPS uses `__Host-optidesk_session`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. Local HTTP uses `optidesk_session`. Each unsafe API request requires an exact matching Origin. Authenticated mutations also require a session-derived CSRF header; that token stays in browser memory and can be recovered through the protected session response. No auth tokens go into localStorage/sessionStorage. Unknown API paths never become SPA HTML.

Login throttle reserves D1 counters atomically before password verification: five attempts per normalized email and twenty per trusted Cloudflare IP within fifteen minutes. Setup and password change have separate throttles. Raw passwords, tokens, email/IP throttle identifiers, request query strings, and D1 errors are not logged. Cloudflare observability redacts query strings and disables automatic invocation logs and traces. Login session inserts re-check the verified credential version atomically so an in-flight old-password login cannot survive a password change.

## Phase 2 customer architecture

The customer API exposes only identity/contact/created/updated/archive fields, never fabricated history or statistics. `GET/POST /api/customers`, `GET/PATCH/DELETE /api/customers/:uuid` and `POST /api/customers/:uuid/restore` use the same existing administrator security boundary; DELETE archives, not hard deletes.

Strict create/nonempty-partial-edit schemas use `shared/phone.ts` for canonical Indian mobile structure. All SQL values are bound, sort identifiers are allowlisted, returned pages are capped at 50 records, query length/parameters are checked, and name wildcards are escaped. Exact full-phone queries use canonical lookup; digits-only partial phones and literal name substrings are supported. List/count execute in one D1 batch snapshot with stable UUID tie-breakers.

Customer mutation, administrator/request-associated audit and persisted response snapshot are one atomic D1 batch. Internal revision comparisons plus conditional audit writes prevent lost concurrent writes and phantom audits; the partial unique index prevents concurrent phone collisions. Archived edits allow restoration conflicts to be resolved without changing identity. Create/update/archive/restore actions append public before/after snapshots to the existing immutable ledger.

The requested customer columns are physically present and required, with legacy optional fields retained. New migration 0004 uses staged rebuilding under deferred foreign keys and preserves IDs, rowids, timestamps, optional fields and children. Unsupported/colliding legacy phones cause a full rollback, not silent data remediation. Actual local application and populated disposable-D1 migration/failure tests passed.

Frontend customer routes provide table/mobile cards, search/filter/sort/pagination, forms, profiles and native dialogs. The existing App route tree/session guards are retained, with a data-router bootstrap for unsaved-navigation blockers. Reload uses `beforeunload`; no draft/customer data is stored in browser persistence. Phase 3 provides real prescription history and Phase 4 provides real purchase history. See [Phase 2 report](phase-two.md) and [current project status](../PROJECT_STATUS.md).

## Phase 3 prescription architecture

The existing prescription table is retained, including legacy clinical text/date/status/actor fields and downstream invoice-item references. New root/parent/revision/reason/near-PD columns plus unique successor/root-version indexes and lineage guards produce linear same-customer chains. Original rows reject UPDATE/DELETE, including no-op updates. Superseded status/replacement/time are derived from a child, never written over the old version. Original timestamps remain intact; the replacement records the edit time.

All prescription routes are nested under an existing customer UUID. Item/history/revision lookups bind both UUIDs; mismatched context returns safe 404. The existing Blaze boundary supplies administrator authentication and unsafe-request Origin/CSRF protections. New root+audit+response and replacement+supersede/revise audits+response are atomic prepared-SQL D1 batches, with customer/current-parent checks inside the write transaction. Audit metadata avoids duplicating clinical values/notes/contact details; recovery comes from immutable versions.

Shared Zod validation stores optional exact decimal strings/nulls, preserving unknown versus explicit zero. Signed SPH/CYL/ADD use diopters; AXIS is optional 0–180 degrees under the established schema; supplied positive distance/near/monocular PD uses mm. Required real prescription dates and optional nonpreceding expiry/recheck dates are validated. No quarter-step rule, typical-age PD range, clinical recommendation or inferred measurement is introduced. New entries/revisions support spectacle prescriptions; legacy other types remain readable. Two fractional digits/six whole digits are an explicit technical encoding bound; higher-precision legacy text is not silently normalized.

Customer profiles/details expose paginated history and immutable original/replacement links. Native dirty-form protections and in-memory query/CSRF conventions are reused; there is no browser persistence, upload or external service. `/prescriptions` guides the owner to an existing customer. Phase 6 supplies invoices and Phase 7 supplies operational reports without clinical exports. See [Phase 3 report](phase-three.md) for clinical references, schema, endpoints, tests and limitations.

## Phase 4 purchase architecture

The existing `purchases(id)` and `purchase_items(id)` tables already contain financial fields and UUID foreign keys. Migration 0006 adds `client_request_id`, `item_count`, and `creation_audit_id` to headers and `snapshot_position` to items. Legacy rows retain NULL in the new columns and preserve every existing field/rowid. New headers require an existing customer, a positive bounded item count and a new audit anchor. New API records use the existing internal `draft` status only to satisfy the old invoice-oriented schema; the UI does not present them as editable drafts or issued invoices.

`creation_audit_id` is a deferred, restrictive FK to the existing immutable audit ledger. The required, unique anchor must point to a newly inserted purchase-create audit whose insert trigger verifies the owning purchase, item count, summed gross subtotal, discounts and tax. Consequently a header cannot commit without its full item set and audit, even if a direct SQL writer skips the audit. The audit seals the set. Item positions are unique and bounded; all purchase/item UPDATE/DELETE and primary-key REPLACE attempts are rejected. Invoice-number reuse is also insert-guarded against SQLite REPLACE semantics. Legacy purchases are now read-only, including unnumbered rows; later financial corrections require a separately designed append-only approach.

Creation is five prepared statements in one D1 `batch()`: conditional customer/Rx-guarded header insert, all items via one parameterized `json_each()` insert, audit, header response and item response. Safe integer values are computed before JSON binding. The statement count stays constant for 1–100 items, within the Free-plan query budget. Customer archive races are checked inside the transaction. Purchase audits carry UUID/date/totals and exact item descriptions/categories/quantities/prices/discounts/totals at creation; notes, clinical values, prescriber and customer contacts are omitted.

Three authenticated Blaze endpoints are nested under `/api/customers/:customerUuid/purchases`: GET list/history, POST creation and GET `/:purchaseUuid` details. Both identifiers are bound for detail/item reads. History pages/counts share a batch snapshot, sort by purchase date/created time/UUID, and allow inclusive `dateFrom`/`dateTo` and item `category` filters. An expression index covers customer/date ordering, including legacy date fallback. No edit/delete API exists. Unknown/duplicate/malformed query parameters, forged totals and out-of-scope tax/payment/invoice fields are rejected.

`shared/money.ts` contains the established integer-paise helpers; `worker/lib/money.ts` re-exports them to preserve existing imports. Input money is decimal rupee text (at most two fractional digits), parsed exactly with BigInt and bounded to `Number.MAX_SAFE_INTEGER` paise. Shared purchase validation/computation gives the UI and backend identical totals. A purchase's subtotal is gross quantity × unit price; its discount combines fixed whole-line and purchase discounts; grand total is subtotal − discount. New purchases have zero tax; readable legacy tax remains part of its original total.

The browser form uses React Hook Form/Zod, dynamic items, optional paginated exact-version prescription choices, live totals, a synchronous submission lock and native dirty-form guards. The required submission UUID is stable for the lifetime of a form, including failed/lost-response retries; a customer/submission unique index returns safe 409 without a second record. Separate forms with independent keys are intentionally not content-deduplicated. Neither drafts nor keys are persisted in browser storage. Customer profiles show filtered, paginated purchase history; details show server totals and permanent snapshots. See [Phase 4 report](phase-four.md).

## Phase 5 payment and credit architecture

Migration 0007 retains `payments(id)` and all original ledger fields, adding nullable `client_request_id` and `creation_audit_id` (deferred restrictive FK to immutable `audit_logs`). Existing rows gain NULL without invented audits. Unique customer/submission and audit indexes, ordered purchase/payment history and a covering partial settled-payment index support the new API. All payment UPDATE/DELETE, including no-ops, and primary-key/submission-key REPLACE attempts are guarded. The existing reversal table is preserved but accepts no new writes or edits/deletes.

Creation uses four prepared statements in one transactional D1 `batch()`: payment insert, minimal creation audit, persisted payment response and derived purchase summary. Preliminary reads only establish customer/purchase context. The INSERT trigger checks current outstanding **inside the serialized write transaction**, so concurrent independent requests cannot commit payments whose sum exceeds the total. It also checks customer ownership/active state, payable purchase/currency, positive safe integer money, method, UTC date and the new audit anchor. The audit trigger binds entity/action/owner/timestamp to the inserted payment; the deferred FK rejects a payment whose audit is skipped. Later failures roll back both payment and audit.

`purchase_payment_balances` derives paid from settled, nondeleted payments, outstanding as stored total minus paid, and paid/unpaid/partially-paid status. Equality is checked first, so a zero-total purchase is paid. The public purchase read/create responses gain those fields without updating headers or items. Inconsistent legacy financial values or posted reversals return `FINANCIAL_DATA_INVALID`; records are never clamped, rounded or rewritten. Customer credit aggregates the entire customer's purchase balances in one SQL read, splitting integer billion-paise components and reconstructing with BigInt to avoid floating aggregation. Totals beyond the existing safe-integer contract return `CREDIT_TOTAL_OUT_OF_RANGE`.

Authenticated Blaze APIs: GET `/api/customers/:customerUuid/credit-summary`; GET/POST `/api/customers/:customerUuid/purchases/:purchaseUuid/payments`; GET the latter path plus `/:paymentUuid`. Every individual lookup binds the full hierarchy. History/count/summary use a common batch snapshot with chronological received-time/created-time/UUID ordering and strict `page`/`pageSize` limits. No payment edit/delete/refund routes exist. Existing Origin/CSRF/session, 16 KiB JSON, safe envelopes/logging and no-store/security conventions apply.

Payment input reuses the purchase decimal-rupee schema and shared exact money helpers. New methods are only Cash/UPI/Card; received time is canonical UTC with milliseconds, defaults to backend now when omitted, cannot be future or precede the purchase date's UTC midnight. The form converts explicit device-local minute precision to UTC. Reference/note are optional and excluded from payment audit JSON, which contains only identities, amount/method and received/created times plus owner/request linkage. UTC and strict query decoding helpers were extracted with existing Worker import contracts preserved.

Customer profiles show total credit and purchase statuses; purchase details show paid/outstanding and paginated individual history. Record Payment is conditional on eligibility. Forms reuse React Hook Form/Zod, synchronous locking and native dirty guards. Stable in-memory UUIDs allow failed/lost-response retries; duplicates return safe 409 even after full settlement. Duplicate/overpayment errors refresh authoritative queries while preserving feedback/drafts; success invalidates all customer purchase/payment/credit queries. Archived customers remain readable and must be restored to record payments. Credit means purchase debt, not a wallet or lending facility. See [Phase 5 report](phase-five.md) and [test coverage](../test/README.md).

At the Phase 5 checkpoint: **1,004 workerd/D1 tests in 23 files; 27 real-backend Chromium scenarios** at desktop/mobile; TypeScript/lint/build and dependency audit passed. Local 0007 applied in 15 commands, repeated with nothing pending. Private before/after comparison preserved every original row/column/rowid, earlier migrations/private variables, and clean FKs/quick check. No persistent development fixture data was created.

## Phase 6 invoice architecture

Migration 0008 adds two strict tables because Phase 4 deliberately forbids assigning an invoice number or snapshot onto an old purchase. `invoices` has unique UUID/purchase/number/reservation, customer/purchase/reservation/owner FKs, issued time, versioned snapshot JSON and a unique deferred restrictive creation-audit FK. `invoice_number_reservations` permanently holds number/sequence, purchase/customer/shop, submission key, owner/time and deferred audit anchor. Both reject UPDATE/DELETE/no-op/REPLACE. Cross-namespace INSERT guards also prevent collision with legacy `purchases.invoice_number`; historical numbered purchases are preserved and cannot be automatically regenerated.

Numbering reuses existing `shop_settings.invoice_prefix`, `next_invoice_number` and padding and matches the established `invoiceNumber()` format (`INV-0001` by default). A reservation INSERT validates the current counter and advances it in an AFTER trigger within the same D1 transaction. Sequence values and formatted numbers are unique; the counter cannot move backward. Only `never` reset is supported; financial-year reset and legacy/restore conflicts fail closed for explicit reconciliation. Reservation+minimal audit+read commit in one three-statement batch; invoice+minimal audit+read commit in a separate three-statement batch. An issue failure retains its committed number/reservation/audit. Gaps are intentional. A failed reservation transaction allocates nothing and exposes no document. Restore procedures must reconcile externally printed records and advance beyond all retained/printed/reserved/legacy numbers before reopening writes.

Generation is explicit and once per purchase; unpaid/partially paid purchases qualify because Phase 4 records are complete immutable transactions, despite an internal `draft` tag. Same-purchase retries reuse an existing invoice with 200, including lost-response retries; first creation returns 201. Concurrent independent attempts can reserve more than one number but only one invoice commits, and unused numbers remain permanently reserved. A reused key with no issued invoice returns `INVOICE_GENERATION_INCOMPLETE`; the UI explicitly offers generation with a new number. Synchronous frontend locking retains the key across uncertain network failures. Archived customers require restoration for first issuance, while issued invoices remain readable.

`invoice_source_snapshots` copies authoritative persisted data inside the issue transaction: shop name/address/contact/GSTIN/footer, customer name/phone, fixed purchase/date/minimal prescription UUID, stored financial/tax fields, ordered original item descriptions/categories/quantities/prices/discounts/taxes/HSN/totals, and Phase 5 paid/outstanding/status plus effective payment count/method totals. Issue time uses the database clock inside the INSERT; the audit copies that persisted timestamp, avoiding an early as-of time from a queued request. The INSERT guard compares the supplied snapshot exactly with that view and rejects unsafe/inconsistent money or empty/oversized item sets. No client financial fields are accepted. Customer address is optional legacy data not required by the application, so it is excluded, as are clinical measurements, notes and payment references. Later identities/payments/settings do not change a reprint. Historical retrieval verifies customer/purchase ownership without querying a live balance read model.

Blaze APIs: GET/POST `/api/customers/:customerUuid/purchases/:purchaseUuid/invoice`; authenticated GET/PATCH `/api/shop/invoice-identity` reuses only existing shop name/address/contact/GSTIN fields. No second settings store or numbering/tax preference API exists. The identity edit uses a concurrency timestamp and conditional audit in one batch. Invoice/number audits store owner/request, IDs, number and event time without copying contacts/clinical values. All routes reuse the established session/Origin/CSRF, strict JSON/UUID, parameterized SQL, response-envelope/no-store/security conventions.

The React invoice page is nested under the existing authenticated shell and opened from purchase details. It reads the permanent snapshot and provides native `window.print()`. A4 portrait CSS uses 14 mm margins, removes shell/navigation/buttons/background, restores a fixed-width compact table with repeated headers, avoids row/header/customer/totals splits, wraps long text and removes application width/spacing restrictions. Screen-only small-width rows become labelled cards; print always uses the table. Browser headers/footers/scaling are controlled by the print dialog, not silently overridden.

Verification: **1,031 workerd/D1 tests across 26 files; 33 real-backend Chromium scenarios**. Six invoice cases invoke native print and produce real A4 PDFs, checking metadata/text/every page's rasterized ink bounds, all 100 items, repeated headers, final totals and excluded application chrome. Short output and first/last pages of the eight-page desktop invoice, plus mobile view, were visually inspected. Poppler tools already installed in the environment perform PDF inspection; no npm/runtime dependency was added. Local 0008 applied in 16 commands, repeat/integrity and private full-row/column/rowid/hash preservation checks passed. See [Phase 6 report](phase-six.md).

## Phase 7 reporting architecture

`worker/services/reports.ts` owns literal allowlisted prepared-SQL report plans. Sales/payments/categories scope persisted activity; outstanding/customer plans reuse `purchase_payment_balances` and aggregate current debt across all retained purchases. Summaries, total counts and ordered detail pages share one read-only D1 batch snapshot: three statements normally, four for payment daily groups. Dashboard uses four SQL summaries in one batch. No ledger/cache tables, financial rewrites or report/export audit writes are introduced. Invoice numbers may be joined for identification, but balances never come from immutable invoice-at-issue snapshots.

`shared/reportDates.ts` centralizes **Asia/Kolkata / IST (UTC+05:30)**, inclusive real calendar dates, 366-day bounds and presets. No existing shop timezone preference was present. Sales/categories use persisted `purchase_date`; NULL legacy dates use the IST day of `created_at`. The earlier customer-history UTC-prefix fallback remains a historical API contract, so NULL legacy dates near India midnight can differ from that listing; source timestamps are not modified. Effective payment receipt timestamps are filtered by bound half-open UTC boundaries corresponding to IST midnight through midnight after the end date. Details label UTC explicitly. Outstanding/customer reports reject date filters; sales balances are current, not a historical end-date debt reconstruction.

Sales include complete saved purchases even before invoice generation, excluding void/refunded/deleted/non-INR activity. Settled/nondeleted INR payments are effective collections, including receipts on older purchases; pending/voided/refunded/deleted receipts do not count. Cash/UPI/Card totals plus a separate retained-legacy-method total reconcile collections. Current credit retains the Phase 5 all-purchase contract, including archived customers and legacy void/refunded/deleted debts; fully paid/zero purchases do not appear as debts. Unsupported reversal/inconsistent financial data fails closed. Categories group original snapshots, seven known keys plus one unknown-legacy bucket; quantity/line counts and recorded line sales include line discounts/persisted tax, without allocating header discounts or inventing inventory metrics.

SQL aggregates integer quotient/remainder components (base one billion), casts them to text, and reconstructs only the constant-size aggregate results with BigInt and the existing safe-integer paise contract. This avoids JavaScript database loading, floating SUM and wide monetary SUM overflow. Rows/counts are checked, and an unrepresentable aggregate returns `REPORT_TOTAL_OUT_OF_RANGE`. Supported limits bound returned data rather than hiding rows behind a truncated total.

The original purchase-date index lacks the NULL IST fallback; the history expression index starts with customer, so neither covers shop-wide range/order queries. Migration 0009 adds partial `idx_purchases_report_date` on `COALESCE(purchase_date,date(created_at,'+330 minutes')) DESC,id`, with exactly the sales eligibility predicate. A separate indexed NULL lookup fails closed on unassignable legacy dates while preserving the main range search. Actual joined-query plans use `SEARCH ... idx_purchases_report_date` without temporary ordering. Existing `idx_payments_status_date`, `idx_payments_settled_purchase` and purchase-item indexes are reused. Credit/customer aggregates necessarily traverse retained shop records; local query plans/5,001-row checks do not establish remote CPU/rows-read quotas.

Authenticated Blaze GET routes expose dashboard, five report types and four CSV downloads. Existing strict query decoding/schema, prepared SQL, safe errors, no-store/security headers and unsafe-request Origin/CSRF apply. Activity ranges are required; current-state ranges, unknown/duplicate parameters and export pagination are rejected. Pages cap at 50 rows/page and 10,000 pages; payment daily groups cap at 366. CSV exports cap at 5,000 rows and 5 MiB, reject oversized output and are never silently truncated. They use the foundation CSV helper extended with UTF-8 BOM/CRLF, quote/newline escaping and apostrophe formula/control defenses (including +91 phones). Filename values are fixed/validated. The route sends through Blaze's response writer using its capitalized Content-Type key to avoid a duplicate octet-stream fallback and retain middleware headers. No clinical measurements, notes/references, tokens or credentials are exported.

React reports reuse the shell, locally owned UI primitives and TanStack Query; filters/page links live in URLs, records/tokens do not persist in browser storage. Reports/dashboard override the general 30-second cache to refetch on revisit and provide explicit refresh/error/retry controls. Responsive detail tables/mobile cards share authoritative summaries. Downloads use credentialed no-store fetch, validate attachment/type, create a transient object URL and revoke it. Files are generated on demand without public endpoints, service-worker storage or R2. See [Phase 7 report](phase-seven.md) for actual checks, interim live preservation, limitations and unexecuted Git commands.

## Verification and delivery gates

1. Foundation/authentication/design system: typecheck, lint, real D1 migration constraints, auth/security tests, browser login/navigation, build.
2. Customers: CRUD, phone normalization/uniqueness, partial search, profile, archived-record safety.
3. Prescriptions: separate OD/OS fields, parameter ranges, optional values, dated history, audit edits.
4. Purchases only: exact multi-item totals, immutable snapshots, optional fixed prescription link, atomic audits/rollback, duplicate protection and customer history. Invoice/tax/print workflows remain separately gated.
5. Payments/credit only: immutable atomic audited payments, concurrent overpayment prevention, duplicate protection, derived balances/status and customer debt. Refunds/reversals and invoice corrections require separate approval.
6. Invoice generation/printing: unique audited sequential reservations, immutable authoritative snapshots, safe retries/hierarchy and actual responsive A4/multi-page output.
7. Reports/exports: exact SQL summaries/current credit, business-date boundaries, complete bounded pagination, authentic CSV/formula/privacy checks, operational dashboard and volume/regression/preservation checks.
8. Final testing, deployment and production readiness: Phase 1–7 regression/security/asset/query review, all major desktop/mobile routes, complete real workflow, local SQL backup round-trip/session/invoice reconciliation and original-database preservation. Then separately approved Free-plan staging CPU/acceptance/recovery, production bindings/migrations/secrets/bootstrap/deployment and controlled smoke. This final phase adds no business module or broader settings/tax/numbering API.

Each phase ends with a tested change report, outstanding issues and unexecuted staging/commit commands. Phase 8 local checks passed **1,073 workerd/D1 tests in 29 files and 42 real-backend Chromium scenarios**, plus typecheck/lint/build/audit and full private original-data/hash/physical-rowid preservation. Stronger console/resource and seven-route desktop/mobile checks passed in both the focused scenario and complete 42-scenario rerun. Remote staging/production gates remain pending explicit approval. See [Phase 8](phase-eight.md) and [deployment](deployment.md).

### Final boundary and recovery corrections

The central `sendResponse()` forwards `Content-Type` with Blaze's exact case-sensitive key. A real `SELF` regression reproduced the previous duplicate JSON/octet-stream fallback; its strengthened exact-header assertion passes in the complete backend suite. Middleware no-store/security/cookie headers remain included.

The preserved 0004 customer rebuild changes physical table order. Pinned Wrangler SQL export can therefore insert prescription data before the referenced customer table exists. `maintenance/prepare-recovery.ts` uses the pinned Wrangler SQL splitter to prepare a **trusted full dump for an empty target**: all tables first, data in relationship order (including audits before financial anchors), original SQLite sequence metadata, then indexes/views/triggers. A per-statement SHA-256 multiset assertion prevents loss/addition/value rewriting. The original dump is retained; the CLI refuses overwriting its input/output. Foreign keys remain enabled. This tool never opens D1 or deploys code and is absent from browser/Worker bundles.

The real browser recovery scenario exports/checksums all business schema/fields, imports into a separate empty disposable D1, compares every original business row/schema, verifies repeat migration/FKs/quick check, revokes restored sessions, rotates only the disposable pepper, authenticates with the original password, reads the unchanged invoice, reconciles a simulated printed-number gap with an audit and issues a unique later number. Its source fixtures and the user's persistent database are preserved. This proves the local round-trip, not remote Time Travel or account quotas.

## Verified platform limits and constraints

Rechecked against official documentation on **5 October 2026**: Workers Free 100,000 dynamic requests/day, 10 ms CPU/request, 128 MB isolate memory and 50 subrequests/request. Direct static assets are free/unlimited requests; 20,000 assets and 25 MiB per asset. D1 Free 5 million rows read/day, 100,000 rows written/day, 500 MB/database, 5 GB/account, 10 databases, 50 queries/Worker invocation and seven-day Time Travel. SQL is limited to 100 bound parameters, 100 KB per statement and 2 MB per row. Account quotas are shared with other applications; actual account plan/usage and deployed CPU remain unverified.

Final built output: approximately 320.89 kB Worker JavaScript (73.79 kB gzip), 667.26 kB client JavaScript (195.79 kB gzip), 28.04 kB CSS (6.47 kB gzip). The existing client chunk warning is nonblocking; bundling/startup/latency still need deployed measurements. The artifact review verified referenced files, static security headers, API-first/SPA routing, only DB/ASSETS bindings, no secret vars/public source maps/private dumps, and no known private secrets/live-record identifiers/test credentials in built runtime. Vite's ignored server-only `.dev.vars` copy is outside public assets and is local configuration, not a production secret-upload file.

D1 `batch()` is transactional. There is no interactive JavaScript transaction spanning independent calls. Reads before a later write do not protect against races. Query/statement bounds and payload limits must be reflected in purchase item caps and bounded exports. Customer leading-wildcard searches/counts can scan candidate rows despite bounded returned pages. SQLite query-plan and disposable 10,000-row checks do not establish deployed D1 latency/quota behavior. Name matching uses SQLite ASCII NOCASE/LIKE, not complete Unicode case folding or diacritic-insensitive search. Avoid FTS virtual tables until a verified SQL-export strategy is in place.

APAC is a placement hint, not a guarantee of India-only residency. No GST legal-compliance or healthcare/privacy-compliance claim is made. Free-tier limits mean availability is not unlimited; quota exhaustion can interrupt normal use. A custom domain registration can cost money; a workers.dev deployment does not require one.

Sources:
- https://github.com/imselmon/blaze
- https://registry.npmjs.org/blazefw/1.0.2
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/
