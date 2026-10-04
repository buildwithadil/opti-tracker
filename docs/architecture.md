# OptiDesk architecture and phase boundaries

## Repository assessment

The requested directory was initially empty apart from harness metadata; it was not then a Git repository. By Phase 3, Phases 1–2 were committed and Git was clean at `f5a9a85` before edits. The local D1 owner and customer records are preserved through local migrations; new interim customer activity is not reset to an older snapshot. There is no existing production database in this workspace. No remote migration, account provisioning, production deployment, or restore has been performed.

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
  routes/               Blaze auth, customer and prescription registration
  validators/           Strict backend path/query schemas
  services/             Atomic throttle/customer audits and append-only prescription writes
  lib/                  Web Crypto, HTTP, D1 and money helpers
shared/                 Customer/prescription contracts, phone and clinical validation
migrations/             Append-only SQL migration files
public/_headers         Security headers for assets served without the Worker
test/                   Workerd/D1 integration and utility tests
e2e/                    Browser tests against real local API and D1
docs/                   Architecture, phase reports, deployment/recovery runbooks
```

## Data relationships

Existing 0001/0002 migrations created the business foundation; 0003 adds integrity corrections. Phase 2 appends 0004 to reconcile customer names/required canonical phones while preserving existing records and child foreign keys. Phase 3 appends 0005 with prescription lineage/near-PD fields and immutable-row guards, without rebuilding the prescription table. Previously applied migrations remain unchanged.

- `admin_users` has one enforced singleton owner. The initial schema contains a legacy role column, but migrations restrict it to owner and neither UI nor API implements roles/staff.
- Owner → many `sessions`. Only HMAC token hashes are stored. The cookie token is 256 random bits. Twelve-hour absolute expiration; logout revokes the current session, password change revokes every active session.
- One `shop_settings` row stores identity, optional GSTIN, invoice format/counter, INR currency, default tax configuration, and footer.
- Customer → many prescriptions and purchases. Customer identity is `uuid`; existing child `customer_id` foreign keys now reference `customers(uuid)`. The partial index on canonical `normalized_phone` applies only where `archived_at IS NULL`. Equivalent Indian mobile inputs cannot bypass active uniqueness, and archived numbers can be reused. Customers are never automatically merged or permanently deleted.
- Customer → multiple prescription roots and immutable linked versions. Existing `prescriptions(id)` stays stable, with `customer_id` referencing `customers(uuid)`; JSON exposes UUID aliases. Each chain has one current head, not one clinically approved prescription per customer.
- Purchase → many line items and payments; optional reference to a specific immutable prescription version. Payments must reference the purchase's customer.
- Payment → many reversal events. The full adjustment/refund semantics are a Phase 5 gate, not currently exposed.
- Audit events are append-only with update/delete guards.
- `auth_rate_limits` holds HMAC-scoped short-lived throttle counters.

Financial values use integer paise; tax rates use integer basis points. Financial calculations use safe integers/BigInt intermediates, not decimal floating-point arithmetic. Future invoice writes must snapshot shop/customer/tax details, use permanent globally unique invoice numbers, and atomically write header/items/payment/audit. Financial statuses and outstanding values must be derived from effective payment/reversal records. These workflows are **not yet implemented**.

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

Frontend customer routes provide table/mobile cards, search/filter/sort/pagination, forms, profiles and native dialogs. The existing App route tree/session guards are retained, with a data-router bootstrap for unsaved-navigation blockers. Reload uses `beforeunload`; no draft/customer data is stored in browser persistence. Purchase history remains an explicit unavailable state; Phase 3 now provides real prescription history. See [Phase 2 report](phase-two.md) and [current project status](../PROJECT_STATUS.md).

## Phase 3 prescription architecture

The existing prescription table is retained, including legacy clinical text/date/status/actor fields and downstream invoice-item references. New root/parent/revision/reason/near-PD columns plus unique successor/root-version indexes and lineage guards produce linear same-customer chains. Original rows reject UPDATE/DELETE, including no-op updates. Superseded status/replacement/time are derived from a child, never written over the old version. Original timestamps remain intact; the replacement records the edit time.

All prescription routes are nested under an existing customer UUID. Item/history/revision lookups bind both UUIDs; mismatched context returns safe 404. The existing Blaze boundary supplies administrator authentication and unsafe-request Origin/CSRF protections. New root+audit+response and replacement+supersede/revise audits+response are atomic prepared-SQL D1 batches, with customer/current-parent checks inside the write transaction. Audit metadata avoids duplicating clinical values/notes/contact details; recovery comes from immutable versions.

Shared Zod validation stores optional exact decimal strings/nulls, preserving unknown versus explicit zero. Signed SPH/CYL/ADD use diopters; AXIS is optional 0–180 degrees under the established schema; supplied positive distance/near/monocular PD uses mm. Required real prescription dates and optional nonpreceding expiry/recheck dates are validated. No quarter-step rule, typical-age PD range, clinical recommendation or inferred measurement is introduced. New entries/revisions support spectacle prescriptions; legacy other types remain readable. Two fractional digits/six whole digits are an explicit technical encoding bound; higher-precision legacy text is not silently normalized.

Customer profiles/details expose paginated history and immutable original/replacement links. Native dirty-form protections and in-memory query/CSRF conventions are reused; there is no browser persistence, upload or external service. `/prescriptions` guides the owner to an existing customer. Purchases/payments/invoices/reports remain deferred. See [Phase 3 report](phase-three.md) for clinical references, schema, endpoints, tests and limitations.

## Verification and delivery gates

1. Foundation/authentication/design system: typecheck, lint, real D1 migration constraints, auth/security tests, browser login/navigation, build.
2. Customers: CRUD, phone normalization/uniqueness, partial search, profile, archived-record safety.
3. Prescriptions: separate OD/OS fields, parameter ranges, optional values, dated history, audit edits.
4. Purchases/invoices: exact totals, configurable tax/HSN, race-safe invoice counter, transaction rollback, snapshots, multi-page print.
5. Payments/corrections: idempotent atomic writes, concurrent overpayment prevention, effective reversal ledger, controlled invoice corrections, audit.
6. Dashboard/reports/exports: Indian business date boundaries, actual collections versus sales, pagination, exports with useful headers and CSV-formula defenses.
7. Settings/security/recovery: editable shop and invoice configuration, audited changes, backup round-trip, security review.
8. Production: explicit approval, isolated staging account/database, remote free-tier CPU checks, migrations/backup, secret bootstrap, deployment, end-to-end acceptance.

Each phase ends with a tested change report, outstanding issues, and staging/commit commands. Until those gates pass, future modules show honest phase notices and no unverified business endpoint is active.

## Verified platform limits and constraints

At research time (October 2026): Workers Free 100,000 dynamic requests/day, 10 ms CPU/invocation, 128 MB isolate memory. Direct static assets are free/unlimited requests. D1 Free 5 million rows read/day, 100,000 rows written/day, 500 MB/database, 5 GB/account, 10 databases; seven-day Time Travel. Account quotas are shared with other applications. Re-check official limits before deployment.

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
