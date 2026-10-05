# OptiDesk

A single-owner optical shop application built with React/TypeScript, a Blaze REST API in Cloudflare Workers, and Cloudflare D1.

**Current scope: Phases 1–4, authentication, customers, prescriptions and purchases.** Customers can be created, searched, edited, archived and restored. Customer-linked spectacle prescriptions can be recorded, viewed and revised with immutable history. Purchases record multiple optical items, original price snapshots, exact totals and an optional prescription version. Payments, invoices, dashboard metrics, reports, exports and editable shop configuration remain future gated phases. This is not yet a complete optical shop application or a production deployment. **Phase 5 has not started.**

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current verification and handoff.

## Structure and architecture

See [docs/architecture.md](docs/architecture.md) for folders, database relationships, implementation gates, and platform constraints. One deployment serves the React static assets and Worker API on the same origin. API routes use `blazefw`, not another framework. All persistent runtime data is in D1; no external storage or paid integration is introduced.

## Local development

Use a supported Node.js LTS release (Node 24 recommended) and npm. Exact dependencies and the lockfile are committed-ready.

```bash
npm ci
# First-time checkout only: do not overwrite an existing private file.
test -f .dev.vars || cp .dev.vars.example .dev.vars
```

On a fresh installation only, fill `.dev.vars` privately with **two different** random secrets generated with `openssl rand -base64 32`: `SESSION_PEPPER` and the one-time `SETUP_TOKEN`. **Keep existing secrets and owner accounts unchanged when upgrading.** Never commit private variables or paste real secrets into issues/chat.

```bash
npm run db:migrate:local
npm run dev
```

Visit the local URL. An existing owner signs in normally; a fresh database redirects to setup. Enter your name, email, a 12–256 character passphrase, confirmation, and the setup secret. There is no default password and no public registration. Setup is blocked permanently once an owner record exists. Keep your passphrase in a trusted password manager.

Sessions use an HttpOnly cookie, expire after twelve hours, and are stored only as HMAC hashes in D1. CSRF tokens are session-derived and held in frontend memory. Changing the password signs out every active session. Auth requests and data are not stored in localStorage.

The daily scheduled task removes only expired session/throttle/security-attempt records. It is not a backup job and never deletes business/audit data.

## Customer management

Open Customers to add profiles, search by literal name or mobile number, choose Active/Archived/All, sort and paginate. Indian mobile inputs such as `9876543210`, `+91 98765 43210` and `09876543210` share the canonical `+919876543210`. Arbitrary punctuation, foreign/invalid mobile structures and active duplicates are rejected.

Customer profiles show contact details, registration/update dates and real prescription and purchase history. Archive actions preserve the record; restoration conflicts can be resolved by editing the archived phone first. See [Phase 2 report](docs/phase-two.md) for API/schema and format details.

Migration `0004_customer_management.sql` is append-only and already applied to this workspace's local database. For a different populated database, take a private backup and review legacy phones first: unsupported inputs/canonical active collisions deliberately abort migration rather than merge or discard records.

## Prescription management

Open a customer's profile and choose **Add prescription**. OD/right and OS/left measurements are grouped separately, with diopter/degree/mm labels, dates and optional prescriber/notes. Unknown fields stay blank/null; explicit zero is retained. There is no automatic clinical calculation, transposition, quarter-diopter restriction or inferred PD.

**Revise prescription** creates a new UUID linked to the previous version and requires a reason. Old rows cannot be overwritten or permanently deleted; version links and paginated history recover every original value. Archived customers retain read-only history until restored. New/revised records support spectacle prescriptions; legacy other types remain readable.

Migration `0005_prescription_management.sql` adds lineage and near PD to the existing table without rebuilding it or changing downstream UUID references. All operations require the existing authenticated API and unsafe-request Origin/CSRF checks. See [Phase 3 report](docs/phase-three.md) for exact rules, precision/type limitations, endpoints and verified results.

## Purchase management

Open a customer profile and choose **Add purchase**. Record the purchase date and one or more items with a product description, optical category, whole-number quantity, unit price and optional fixed line discount. An optional purchase discount applies after line discounts. The live preview uses the same exact integer-paise calculations as the backend; saved details show backend-calculated totals.

A purchase may link any specific prescription version belonging to the same customer, or no prescription. Choices are paginated; selecting an older version remains explicit and a later prescription never changes the link. Purchase history supports pagination, inclusive purchase-date filters and item-category filtering. Archived customers retain readable history but must be restored before creating a purchase.

Saved purchases and their item snapshots cannot be edited, replaced or permanently deleted. Duplicate submissions with the same customer/submission UUID are rejected, including concurrent requests and retries after a lost response. Drafts and submission keys live only in memory, so a reload/discard loses the unsaved draft. Migration `0006_purchase_management.sql` extends the existing tables, preserving legacy rows and earlier migrations. It has been applied to this workspace's existing local database after a private export and record-preservation verification. See [Phase 4 report](docs/phase-four.md) for schema, endpoints, money rules, audit strategy, limits and actual checks.

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```

Real-browser tests use a disposable **local-only** D1 database, the real Worker, and the built frontend:

```bash
npx playwright install chromium
npm run test:e2e
```

Test credentials in `e2e/` are fixtures only, not production defaults. No tests access a remote database. Browser test state is isolated in a temporary directory; failures and screenshots are ignored in `test-results/`.

## Production is not yet approved

Do not run deployment or remote migrations during ordinary development. The source Wrangler D1 binding deliberately contains no production database ID. Create an explicitly named remote database only with the owner's approval, then add its ID. Do not rely on automatic provisioning for an existing shop.

Before production use, complete the later phases and run the full acceptance suite. A remote Free-plan CPU check is required for the native PBKDF2 password work factor; a successful local workerd test is not proof of the 10 ms Free-plan CPU budget. This work factor must not be silently weakened. See [docs/deployment.md](docs/deployment.md).

## Backup and recovery

No automated external backup is currently configured. D1 Free Time Travel provides seven days of automatic point-in-time recovery but is not an independent backup. Recommended daily SQL exports, private storage, and restore verification are documented in [docs/backup-and-restore.md](docs/backup-and-restore.md). CSV exports will be implemented through the authenticated API in Phase 6.

## Phase reports

[Phase 1](docs/phase-one.md), [Phase 2](docs/phase-two.md) and [Phase 3](docs/phase-three.md) are historical checkpoints. [Phase 4](docs/phase-four.md) records purchase management, **901 passing workerd/D1 tests and 19 passing Chromium scenarios**, limitations and exact Git staging/commit commands. All Phase 1–3 regression suites passed. No remote production data has been modified, and Phase 5 has not started.
