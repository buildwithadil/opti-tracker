# OptiDesk

A single-owner optical shop application built with React/TypeScript, a Blaze REST API in Cloudflare Workers, and Cloudflare D1.

**Delivered scope: authentication, customers, prescriptions, immutable purchases/payments, credit, invoice printing, operational reports and CSV exports. Phase 8 local final acceptance and isolated SQL recovery have passed; remote staging and production deployment remain pending approval and prerequisites.** Invoices preserve payment position at issue; reports use live authoritative balances. Dashboard summaries show real daily activity and current credit/customer counts.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the current verification and handoff.

## Structure and architecture

See [docs/architecture.md](docs/architecture.md) for folders, database relationships, implementation gates, and platform constraints. One deployment serves the React static assets and Worker API on the same origin. API routes use `blazefw`, not another framework. All persistent runtime data is in D1; no external storage or paid integration is introduced.

## Local development

Use a supported Node.js LTS release (Node 24 recommended) and npm. Exact dependencies and the lockfile are committed.

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

Customer profiles show contact details, registration/update dates, real prescription and purchase history, and total outstanding credit. Archive actions preserve the record; restoration conflicts can be resolved by editing the archived phone first. See [Phase 2 report](docs/phase-two.md) for API/schema and format details.

Migration `0004_customer_management.sql` is append-only and already applied to this workspace's local database. For a different populated database, take a private backup and review legacy phones first: unsupported inputs/canonical active collisions deliberately abort migration rather than merge or discard records.

## Prescription management

Open a customer's profile and choose **Add prescription**. OD/right and OS/left measurements are grouped separately, with diopter/degree/mm labels, dates and optional prescriber/notes. Unknown fields stay blank/null; explicit zero is retained. There is no automatic clinical calculation, transposition, quarter-diopter restriction or inferred PD.

**Revise prescription** creates a new UUID linked to the previous version and requires a reason. Old rows cannot be overwritten or permanently deleted; version links and paginated history recover every original value. Archived customers retain read-only history until restored. New/revised records support spectacle prescriptions; legacy other types remain readable.

Migration `0005_prescription_management.sql` adds lineage and near PD to the existing table without rebuilding it or changing downstream UUID references. All operations require the existing authenticated API and unsafe-request Origin/CSRF checks. See [Phase 3 report](docs/phase-three.md) for exact rules, precision/type limitations, endpoints and verified results.

## Purchase management

Open a customer profile and choose **Add purchase**. Record the purchase date and one or more items with a product description, optical category, whole-number quantity, unit price and optional fixed line discount. An optional purchase discount applies after line discounts. The live preview uses the same exact integer-paise calculations as the backend; saved details show backend-calculated totals.

A purchase may link any specific prescription version belonging to the same customer, or no prescription. Choices are paginated; selecting an older version remains explicit and a later prescription never changes the link. Purchase history supports pagination, inclusive purchase-date filters and item-category filtering. Archived customers retain readable history but must be restored before creating a purchase.

Saved purchases and their item snapshots cannot be edited, replaced or permanently deleted. Duplicate submissions with the same customer/submission UUID are rejected, including concurrent requests and retries after a lost response. Drafts and submission keys live only in memory, so a reload/discard loses the unsaved draft. Migration `0006_purchase_management.sql` extends the existing tables, preserving legacy rows and earlier migrations. It has been applied to this workspace's existing local database after a private export and record-preservation verification. See [Phase 4 report](docs/phase-four.md) for schema, endpoints, money rules, audit strategy, limits and actual checks.

## Payments and credit management

Open a purchase from its customer's profile and choose **Record Payment**. Enter a positive decimal rupee amount, choose Cash, UPI or Card, and optionally supply a reference and note. The default amount is the current outstanding balance; a smaller amount records a partial payment. The form displays device-local date/time and stores canonical UTC. Payment time cannot precede the purchase date's UTC midnight or be in the future.

Purchase details show each individual payment chronologically, paid and outstanding amounts, and Unpaid/Partially paid/Paid status. Customer outstanding credit is the sum of purchase balances, independent of the displayed history page or filters. Zero-total purchases are paid. The backend derives these figures from immutable purchase totals and settled, nondeleted payment records; recording payments never edits a purchase or its items.

Payments cannot be edited or deleted. Database guards prevent concurrent overpayment and duplicate customer/submission UUIDs, including retries after a full-payment response is lost. Drafts/keys remain in memory only; confirm an uncertain save in payment history before opening a new form. Archived customers retain readable history/credit but require restoration to record payments. Refunds, reversals, customer wallets and lending are not enabled.

Migration `0007_payment_management.sql` extends the existing payment ledger with submission/audit anchors, indexes, immutable guards and a balance view. It has been applied to this workspace's existing local D1 after private before/after preservation checks. Unsupported legacy financial/reversal data produces a safe review-required error rather than an invented or clamped balance. See [Phase 5 report](docs/phase-five.md) for exact rules, endpoints, concurrency, audits, limitations and verified results.

## Invoice generation and printing

Complete **Settings → Invoice business information** with the actual shop name, address, contact number and optional GSTIN. This updates only the existing shop fields; numbering/tax preferences remain outside this phase. Then open a purchase, select **View invoice**, and explicitly **Generate invoice**. A saved Phase 4 purchase is eligible even when unpaid or partially paid; its internal `draft` field is not an editable draft. Archived customers must be restored before first generation but retain access to issued invoices.

Generation reserves a unique sequential number from existing shop configuration and creates one immutable invoice per purchase. Retries after success reuse it, including a lost response. Committed number reservations remain consumed if issuing fails; gaps are audited and numbers are not silently reused. Only the existing `never` reset policy is supported. Historical number collisions/restores require sequence reconciliation as documented in the [recovery runbook](docs/backup-and-restore.md).

Invoices preserve shop/customer identity, original items/discounts/totals, a minimal optional prescription UUID and the payment position **at issue**. Later customer/shop changes or additional payments do not change a reprint. Current balances remain on purchase details. Customer addresses, clinical measurements and private notes/payment references are excluded. Tax amounts/rates appear only when actually recorded on the purchase/items; new Phase 4 purchases have no tax. No tax engine or legal GST-compliance claim is introduced.

Use **Print invoice** for native A4 portrait printing with 14 mm margins, repeated table headers and no application navigation/buttons. Choose A4, default/100% scaling, and disable browser-generated headers/footers in the print dialog. Short documents and 100-item multi-page PDFs were verified in Chromium. Migration `0008_invoice_management.sql` has been applied locally with private preservation checks. See the [Phase 6 report](docs/phase-six.md) for numbering, snapshots, APIs, actual checks and limitations.

## Reports and exports

Open **Reports**, select Sales, Payments, Outstanding credit, Customers or Product categories, and apply a preset/custom date range for activity reports. Dates are inclusive **Asia/Kolkata (IST)** business days, at most 366 days. Sales/categories use the recorded purchase date; NULL legacy dates use the created timestamp's IST date. Payments use received time converted to a half-open UTC interval. Today/Yesterday/Last 7/Last 30/This month to date/Previous month presets are available.

Sales show persisted gross/discount/tax/grand totals plus **current paid/outstanding** amounts, including later payments. Payment reports show actual effective receipts and Cash/UPI/Card/retained legacy-method totals and daily grouping; receipts can belong to older purchases. Category reports use original item snapshots and recorded line totals; purchase-level discounts are not allocated to category totals. Unknown legacy categories remain a separate group.

Outstanding and customer reports describe the current all-date position. Archived debts remain visible, and fully paid/zero purchases contribute no debt. Outstanding reuses the established all-retained-purchase credit calculation, including legacy void/refunded/deleted debts; activity sales exclude those statuses and non-INR purchases. Reports do not change records or issued invoices. Dashboard cards expose today's sales/collections/purchases and current credit/customer/debtor counts, with explicit refresh controls.

**Download CSV** exports the selected report/range independently of the visible page. Sales, payments, outstanding and category exports require the existing owner session and are capped at **5,000 rows / 5 MiB**, with a clear error instead of truncation. UTF-8 CSV uses exact rupee decimals, CRLF rows and escaped quotes/commas/newlines. Spreadsheet-risk text, including `+91` phones, is prefixed with an apostrophe to prevent formula execution. Clinical measurements, notes, references and authentication secrets are excluded. Downloads are generated on demand and are not kept in application/browser storage.

Migration `0009_report_indexes.sql` adds only an indexed sales/category date expression and has been applied locally with integrity/preservation verification. Existing owner/customer/clinical/audit records and audited interim live purchase/payment/invoice activity were retained. See [Phase 7 report](docs/phase-seven.md) for exact date/credit/category rules, APIs, query strategy, security, verification and limits.

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

Invoice print assertions additionally require the free Poppler tools `pdfinfo`, `pdftotext` and `pdftoppm` on `PATH`; they inspect actual PDF page geometry/text and rasterized ink margins. These tools were already installed in the verification environment. Test credentials in `e2e/` are fixtures only, not production defaults. No tests access a remote database. Browser test state is isolated in a temporary directory; failures, SQL recovery fixtures, PDFs, CSVs and screenshots are ignored in `test-results/`.

Final verification: **1,073 real workerd/D1 tests in 29 files and 42 real-backend Chromium scenarios**, with TypeScript, ESLint, build and zero-vulnerability audit passing. The final browser scenario covers all seven desktop/mobile routes, browser console/resource checks, a complete paid customer→prescription→purchase→invoice→reports/CSV workflow and full isolated SQL recovery with unique reconciled invoice numbering. Existing local SQL exports and every original row/field/physical rowid, migration and private-variable hash remain identical. See [Phase 8](docs/phase-eight.md).

## Production is not yet approved

Do not run deployment or remote migrations during ordinary development. The source Wrangler D1 binding deliberately contains no production database ID. Create an explicitly named remote database only with the owner's approval, then add its ID. Do not rely on automatic provisioning for an existing shop.

Before production use, approve the exact remote account/resource/binding/migration/secret/deployment actions, verify shared Free-plan quotas and actual business identity, then pass staging acceptance and the native PBKDF2 CPU benchmark. Successful local workerd tests are not proof of the **10 ms Free-plan CPU budget**, particularly for password change, which verifies and derives credentials. The 600,000-iteration work factor must not be silently weakened. No account inspection, remote migration/deployment or production smoke has been performed. See [docs/deployment.md](docs/deployment.md).

## Backup and recovery

No automated external backup is currently configured. D1 Free Time Travel provides seven days of automatic point-in-time recovery but is not an independent backup. Recommended daily SQL exports, private storage, invoice-sequence reconciliation and restore verification are documented in [docs/backup-and-restore.md](docs/backup-and-restore.md). Phase 8 actually rehearsed full SQL export/import into an empty isolated local target. The offline `maintenance/prepare-recovery.ts` tool orders trusted pinned-version exports correctly after the earlier customer-table rebuild; review the runbook before any restore. Business CSV exports do not replace full SQL backups.

## Phase reports

[Phases 1–6](docs/phase-six.md) and [Phase 7](docs/phase-seven.md) are historical checkpoints, committed through `ea6f27e`. [Phase 8](docs/phase-eight.md) records final local acceptance, concrete JSON-header/recovery fixes, **1,073 backend tests / 42 Chromium scenarios**, preservation evidence, production blockers and exact unexecuted staging/commit commands. Phase 8 changes are uncommitted; production readiness remains conditional on the remote gates.
