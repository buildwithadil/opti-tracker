# Mobile-first shop workflow redesign

Baseline: `e948138` (Phases 1–8 locally accepted). Work is on `redesign/mobile-first-shop-workflow`; the pre-existing staging binding is intentional and preserved. This is a product workflow redesign, not a new financial system.

## Design assessment and information architecture

Previously seven primary concepts competed in the shell: Dashboard, Customers, Sales & Purchases, Prescriptions, Payments, Reports, Settings. Global purchase/payment/prescription workspaces only directed the owner back to customers. A profile displayed contacts, credit and every history together. Sale, payment and invoice were separate navigation journeys. Mobile hid daily actions in a hamburger; forms exposed optional technical fields upfront.

Proposed navigation: **Home, Sales, Customers, More**, with a prominent persistent **New Sale** action. Home shows today's sales/collections, live all-date credit, customer/payment shortcuts, recent sale cards and people who owe money. Outstanding is one action away. More holds Reports, payment history, prescriptions, Settings. Desktop uses the same flat model with additional space, not a separate admin hierarchy.

## Workflow matrix (design target)

Counts are navigation/confirmation taps from Home, excluding typing and item controls; default existing customer, one payable bill, and configured invoice identity.

| Workflow | Previous mobile flow | Redesigned target |
|---|---|---|
| Customer creation | Menu → Customers → Add → Save (~4) | Home → Add Customer → Save (2) |
| Sale + initial payment + invoice | Menu → Customers → profile → Add purchase → Save → Record payment → Save → View invoice → Generate → Print (~10) | New Sale → customer → items → payment/Complete → Print (~5) |
| Collect money | Menu → Customers → search → profile → sale → payment → Save (~7) | Receive Payment → customer → bill only if needed → Receive (3–4) |
| Find customer | Menu/Customers/Search | Customers tab, immediate debounced search |
| Check credit | Overview/report navigation | Home Outstanding action (1) |
| Prescription | Long mixed profile → locate history | Customer → Prescriptions tab → record |
| Add customer inside sale | Leave draft, create, return/restart | Two-field sheet; saved customer auto-selected |

## Priorities and components

P0: action-led navigation/Home; guided New Sale; inline name/phone creation; direct collections. P1: sale/outstanding cards; searchable useful customer summaries; tabbed customer profile; compact paired OD/OS prescription entry. P2: existing invoice print, reports and account/settings integration.

Reusable elements: accessible 44–48px buttons/inputs/action links, cards/list rows, native modal sheets with contained/restored focus, tabs with arrow-key navigation, badges, pagination, compact page headers, progressive optional sections, sticky primary actions, and real loading/error/retry/empty states. No UI framework/dependency is added.

## Backend scope and checkout integrity

Add only protected paginated **read** views for all-date shop sales, customer credit/last-sale summaries and payment receipts. Existing customer-nested APIs cannot efficiently provide these shop-wide workflows: per-row requests cause N+1 reads, and reusing date-limited reports would hide older history. Query values remain bound; page/size/filter schemas remain strict. New views use the established authoritative balance read model and exact integer-paise aggregation; unsafe balances require review.

All creates still use the existing audited customer/prescription/purchase/payment/invoice APIs. Checkout is a sequence of existing atomic transactions, not falsely described as one atomic transaction. Submission UUIDs stay stable in memory across retries. Exact authenticated submission lookup recovers purchases/receipts after uncertain responses; the flow retains committed progress, locks already-saved inputs and resumes later steps. It never retries with a fresh key or creates an invoice before initial payment is confirmed. Invoice reservations/gaps/snapshots and clinical versions remain permanent. No migration is planned.

## Mobile and acceptance plan

Primary: 360×800, 375×812, 390×844, 412×915. Also 768×1024, 1024×768, 1440×900. Verify all major pages/forms/sheets, no document overflow, usable touch targets/focus, loaded assets and real API/console behavior. Preserve the original backend and E2E business/security/printing assertions while updating genuinely changed navigation/labels.

Add the exact Rahul Sharma /9876543210 workflow: OD −1.50/−0.50/90, OS −1.25/−0.25/85; ₹2,000 frame + ₹3,000 lenses, ₹2,000 UPI at checkout, immutable invoice, ₹3,000 cash later, zero credit, searchable sale and preserved prescription history. Add uncertain-response, validation, multi-bill and responsive regression coverage. All fixtures stay in temporary local D1.

## Infrastructure boundary

Remote D1 migration/deployment/production are unapproved. The existing `optidesk_staging` remote binding does not serve app queries, which use `env.DB`. A future isolated named staging environment must bind `DB` to `5fc6c1c4-c43a-4b59-a606-18fbadc22a5d`, select `optidesk-staging` Worker name and demo-mode frontend at build time. Local DB/private variables/state remain preserved; unrelated `huelane-dev` is never used. Native 600,000-iteration KDF still needs actual Free-plan staging CPU verification before a client demo can be accepted. No R2/paid service or production resource is introduced.

## Implementation results — 6 October 2026

The redesign is implemented on `redesign/mobile-first-shop-workflow` as uncommitted review work. The persistent local D1 remains unchanged; the redesign uses additive authenticated read views and the existing audited write services.

- Shell: Home, Sales, Customers and More; desktop sidebar and five-position mobile navigation with persistent New Sale.
- Home: today’s sales/collections, all-date outstanding, Add Customer, Receive Payment, recent sales and debtors.
- New Sale: three-stage Customer → Items & optional prescription → Payment/Complete flow; inline customer and prescription sheets, exact totals, pay-later, invoice generation and native print handoff.
- Receive Payment: direct customer/sale links, automatic single-bill selection, multi-bill choice, stale-balance refresh, dirty guards and same-key lost-response recovery.
- Customers/profile: summary balances and last sale, immediate search, useful actions, and Overview/Sales/Prescriptions/Payments tabs. Existing nested record URLs and archive/restore remain available.
- Prescriptions: shared compact paired OD/OS entry with progressive optional details; revision lineage and legacy read-only behavior remain unchanged.
- Shop APIs: protected `/api/sales`, `/api/shop/customers` and `/api/shop/payments`; strict bounded queries, exact authoritative balances, legacy fail-closed behavior and no writes/migrations.
- Recovery and acceptance: sale/payment/invoice response-loss recovery, rejected payment correction, stale collection correction, multi-bill collection, pending sheet dismissal locks and seven-viewport overflow/focus checks.

Actual local checks:

| Check | Result |
|---|---|
| `npm run check` | Passed: TypeScript, ESLint, **1,099 Workerd/D1 tests across 31 files**, production build |
| `npm audit` | 0 vulnerabilities |
| `npx playwright test` | **57 real-backend Chromium scenarios passed** |
| Responsive acceptance | 360×800, 375×812, 390×844, 412×915, 768×1024, 1024×768 and 1440×900 passed with no document overflow |
| Rahul workflow | Rahul Sharma / 9876543210, OD/OS values, ₹2,000 UPI + ₹3,000 Cash, immutable invoice, zero credit and searchable history passed |
| Shop API tests | Exact search/pagination/status/date/submission scopes, legacy fallback/overflow/privacy/read-only checks passed |
| Preservation | `remoteBindings:false` before/after comparison passed: rows, values, rowids, schema, migrations, private-variable hashes, foreign keys and `quick_check` unchanged |
| Local staging build | `npm run build:staging` passed; generated Worker is `optidesk-staging`, app binding is `DB` to the approved staging UUID with `remote:false`, demo banner is compile-time enabled |
| Remote activity | None: no remote migration, deployment, secret operation, benchmark or unrelated-resource modification was performed |

The standard large-client-chunk warning and existing Blaze sourcemap warnings remain nonblocking. The source root binding `optidesk` and intentional top-level `optidesk_staging` resource binding are preserved. Wrangler warns that top-level bindings are not inherited by named environments; this is intentional because staging explicitly binds the application’s `DB` name and does not use the auxiliary binding.
