# Phase 3 — Prescription Management

## Outcome and scope

Prescription management is implemented and locally verified. Phases 1–2 remain functional. **Phase 4 has not started.** No remote Cloudflare operation, deployment, secret regeneration, dependency addition, or Git commit occurred.

The first step was inspecting the current status/README/architecture, all existing migrations, customer APIs/profile/router, Blaze authentication/Origin/CSRF boundary, validation and atomic audit conventions, owned UI components and real workerd/browser tests. Git was clean at Phase 2 commit `f5a9a85`. The original prescription schema was reused rather than replaced by a second architecture.

## Features

- Existing-customer prescription creation, full details and paginated customer history.
- Separate OD/right and OS/left SPH, CYL, AXIS and ADD.
- Required prescription date; optional expiry/recheck date, prescriber and multiline notes.
- Optional distance, near and OD/OS monocular PD in millimetres.
- Blank/unknown values remain null; explicit zero remains distinguishable.
- Revision workflow creates a linked replacement with a required reason; original values remain available and immutable.
- Current/superseded/legacy-archived status, previous/replacement/original links, and paginated revision history.
- Desktop/mobile forms/details/history, real loading/error/empty/success states, double-submit protection and unsaved cancel/navigation/back/reload guards.
- Archived customers retain readable history but must be restored before new prescriptions/revisions.
- `/prescriptions` is a working customer-selection gateway, not a fabricated global report.

## Optical conventions and validation decisions

This is a **transcription/history module**, not an examination, recommendation, prescription calculator or medical-compliance certification. The supplied clinical record remains authoritative.

References inspected before choosing units and rules:
- [American Academy of Ophthalmology: reading an eyeglasses prescription](https://www.aao.org/eye-health/glasses-contacts/how-to-read-eyeglasses-prescription): OD/OS, signed lens powers in diopters, axis orientation and ADD.
- [College of Optometrists: pupillary distance](https://www.college-optometrists.org/clinical-guidance/guidance/knowledge,-skills-and-performance/prescribing-spectacles/pupillary-distance-(pd)): PD is a dispensing measurement and is not mandatory clinical prescription content.
- [Specsavers: pupillary distance](https://www.specsavers.co.uk/glasses/buyers-guide/how-to-measure-your-pupillary-distance): millimetre units; typical adult ranges are not applied as universal validation limits.

Shared server/form validation lives in `shared/prescriptionValidation.ts`:

| Field | Rule |
|---|---|
| Prescription date | Required real `YYYY-MM-DD` calendar date, years 0001–9999 |
| Expiry/recheck date | Optional; real date, not before prescription date |
| SPH/CYL/ADD | Optional exact signed decimal; plus/minus supported; canonical two fractional digits, e.g. `+1.13`, `-0.50`, `0.00` |
| AXIS | Optional whole number **0–180 inclusive**, preserving the established project's range; 0 and 180 describe the same orientation |
| PD fields | Optional positive decimal millimetres; no age-specific/adult-normal range or forced total/monocular equality |
| Prescriber | Optional trimmed text, maximum 200 characters; control/bidi characters rejected |
| Notes | Optional trimmed text, maximum 2,000 characters; LF line breaks allowed, other control/bidi characters rejected |
| Revision reason | Required for revisions, 1–500 trimmed characters; control/bidi characters rejected |

Decimals accept decimal strings or finite JSON numbers at the API boundary, without floating-point calculation/rounding. There is a **technical encoding bound** of six whole digits and at most two fractional digits; it is not a clinical normal-strength limit. Excess precision, exponent notation, NaN/infinity, invalid strings and negative/zero PD are rejected rather than silently changed. Negative zero power becomes explicit `0.00`. Optional omitted/null/blank measurements become null on creation; omitted revision fields retain previous values, while explicit null clears optional values.

No quarter-diopter step restriction, CYL/AXIS pairing requirement, near-PD subtraction, monocular sum calculation, sphere/cylinder transposition, automatic expiry decision or inferred zero is implemented. Date-only records are allowed when measurements are not supplied. “Current” means the latest saved version in **one revision chain**, not that a prescription is clinically suitable/unexpired or the only prescription for that customer.

New entries are **spectacle prescriptions**. Original contact-lens/other records remain readable, but this phase does not provide contact-lens fitting/brand/base-curve/diameter fields or permit their revision through a spectacle form. Structured prism fields were not present in the established model and are not added; supplied additional information can be retained in notes. Owner/optometrist review is recommended before real clinical use; broader precision/form/type requirements need explicit agreement, not silent conversions.

## Database migration

Added `migrations/0005_prescription_management.sql`; migrations 0001–0004 are unchanged.

The existing `prescriptions` table and its `id`/`customer_id` columns remain in place. IDs are UUID values; the API aliases them as `uuid`/`customer_uuid`. The existing FK already references `customers(uuid)`. Purchases and purchase items continue referencing the stable `prescriptions(id)` key; no customer data is duplicated.

New columns:

```sql
root_id         TEXT REFERENCES prescriptions(id) ON DELETE RESTRICT
supersedes_id   TEXT REFERENCES prescriptions(id) ON DELETE RESTRICT
revision_number INTEGER NOT NULL DEFAULT 1 CHECK (... >= 1)
revision_reason TEXT NULL
near_pd         TEXT NULL
```

Existing rows receive `root_id = id`, revision 1, and null parent/reason/near PD. **Every old field, rowid, timestamp, measurement text, archived/deleted flag, and downstream reference is preserved.** Invalid/incomplete/noncanonical legacy values are not normalized away by migration.

Indexes:
- `uq_prescriptions_successor`: one child per `supersedes_id` (partial unique index).
- `uq_prescriptions_root_revision`: one numbered version per root.
- `idx_prescriptions_history`: customer/root/revision history.
- `idx_prescriptions_customer_history`: customer/prescribed date/created timestamp/ID ordering.

Guards:
- `prescriptions_lineage_insert`: root owns its ID/version 1; successors belong to the same customer/root, follow the current active undeleted parent by exactly one version, and carry a reason. Branches, cycles, skips and reassignment are rejected.
- `prescriptions_immutable_update` and `prescriptions_immutable_delete`: all original and newly inserted prescription rows are append-only, including no-op updates.

The actual existing local D1 migration ran **14 commands successfully**. Repeat application reported **no pending migrations**. A private ignored SQLite backup was taken beforehand. Read-only preservation checks confirmed original rows/fields, owner account, private secret files and prior migration files remain intact; foreign keys are clean.

An additional customer and its create audit appeared in the local database during the development interval, before the migration. It was preserved rather than resetting the database to the earlier empty-customer snapshot. Final observed local counts: one owner, one customer, zero prescriptions/purchases/payments. No test clinical records were imported into the existing development database.

## History and audit strategy

Creating a prescription writes a new root UUID. Revising an unsuperseded prescription writes a **new UUID**, the same customer/root, the next revision number, a direct `supersedes_id`, the supplied replacement fields and a revision reason.

The old row is **never updated**, even to mark supersession. Its status, replacement UUID and superseded time are derived from its child. Original `created_at`/`updated_at` remain unchanged; the replacement has its own save timestamps. A reference to an older prescription therefore continues to retrieve its exact recorded measurements.

Customer history shows all records/versions, newest prescription date first, then created time descending and ID ascending. Chain history shows highest revision first. Independently created roots can each have a current version. Deleted/archived legacy records remain readable as archived history; there is no prescription DELETE API.

Root insert/create audit/response read and child insert/supersede audit/revise audit/response read execute in **atomic D1 batches**. Customer active state and current-parent checks are repeated within the write transaction; a pre-read is not treated as a lock. Unique successor/root-version indexes and lineage guards prevent racing revisions from branching. A stale loser receives 409 and creates neither row nor audit. Any audit failure rolls back the entire transaction.

The existing immutable audit ledger records:
- `create` associated with the root prescription.
- `supersede` associated with the old version.
- `revise` associated with the replacement version.

Events include the authenticated administrator, request ID, identity/lineage/version/date/status before/after metadata. They **do not duplicate clinical powers/PD/prescriber/notes/revision-reason or customer contact data**. Exact clinical values remain recoverable from immutable prescription records. No clinical payloads enter application logs.

## API endpoints

All routes use the existing Blaze register/wrapper/envelope conventions, behind unchanged owner authentication. Customer context is mandatory:

| Endpoint | Behavior |
|---|---|
| `GET /api/customers/:customerUuid/prescriptions` | All customer versions, paginated |
| `POST /api/customers/:customerUuid/prescriptions` | Create spectacle root; HTTP 201 |
| `GET /api/customers/:customerUuid/prescriptions/:prescriptionUuid` | Full scoped details |
| `PATCH /api/customers/:customerUuid/prescriptions/:prescriptionUuid` | Append replacement; HTTP 201 |
| `GET /api/customers/:customerUuid/prescriptions/:prescriptionUuid/history` | Complete paginated chain |

Create input uses `prescribed_on` plus optional `expires_on`, `right_sphere`, `right_cylinder`, `right_axis`, `right_addition`, left equivalents, `distance_pd`, `near_pd`, `right_pd`, `left_pd`, `prescriber_name`, `notes`. Revision accepts a nonempty partial set of these fields plus required `revision_reason`. Unknown identity/customer/type/status/lineage/private fields are rejected. Merged revision values are revalidated, including date relationships.

List/history only accept `page` (1–10,000, default 1) and `pageSize` (1–50, default 20). Duplicate/unknown/malformed query parameters are rejected. List data is `{prescriptions, pagination:{page,pageSize,total,totalPages}}`; history adds `root_uuid`. Empty lists have total 0 and at least one page. List/count use the same D1 batch snapshot. Both history/details/revision lookups bind **customer UUID and prescription UUID**, not just the item ID.

Safe errors include:
- `INVALID_INPUT` 400.
- `CUSTOMER_NOT_FOUND` 404.
- `PRESCRIPTION_NOT_FOUND` 404, including wrong customer/item pairings without disclosing the other customer's data.
- `CUSTOMER_ARCHIVED` 409 for new/replacement writes.
- `PRESCRIPTION_NOT_CURRENT` 409 for stale/superseded/archived versions or a losing race.
- `PRESCRIPTION_UNSUPPORTED_TYPE` 409 for legacy non-spectacle revision attempts.
- Existing safe auth/Origin/CSRF/media/body-size/internal errors unchanged.

The single owner legitimately accesses the shop's customers; customer-context isolation is not a newly invented staff/permissions system.

## Frontend and security

Routes:
- `/customers/:uuid/prescriptions/new`
- `/customers/:uuid/prescriptions/:prescriptionUuid`
- `/customers/:uuid/prescriptions/:prescriptionUuid/revise`
- Existing `/prescriptions` now guides the owner to customer profiles.

Customer profiles have a real **Prescription history** section with dates, OD/OS summaries, status, details links and paginated access to all versions. Details include full measurements/units, notes, dates, version links and revision history. Creation/revision reuse the shared validation, RHF/Zod, TanStack Query, owned neutral components and Phase 2 native dirty-form protections. Blank measurements display “Unknown,” not a fabricated zero. Prescriber and notes are optional. Pending locks prevent repeated clicks, errors retain entered values, and success refetches inactive original-version caches as well as current history.

Owner setup/login/password/session/throttling and customer CRUD implementations remain unchanged. Unsafe prescription requests require existing exact-Origin/session-derived-CSRF protections, strict schemas, parameterized SQL and the 16 KiB JSON boundary. No clinical data is written to localStorage/sessionStorage, public assets or logs. Only normal runtime/query memory holds fetched records. Native browser forms have autocomplete disabled for prescription inputs. No uploads/scans/R2/external storage or services were introduced.

## Actual checks executed

The parent reran the complete gate successfully:

```bash
npm run check && npm run test:e2e && git diff --check && npm audit
```

| Gate | Actual result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Workerd/D1 backend tests | **797 passed across 15 files**: original 536 plus 261 prescription tests |
| Existing Phase 1/2 regressions | All retained and passed; fixtures adapted for root IDs/new trigger/ledger and old migration-specific boundaries |
| Populated migration | Original clinical values/rowids/timestamps/table/child FKs preserved; repeat application and guards passed |
| D1 integrity/concurrency | Independent FK/index constraints, lineage/branches/cycles, all-column immutability, same-parent races at three depths, archive races, audit rollback, list/history snapshots passed |
| Full real-backend Chromium suite | **11 passed**: five Phase 1/2 cases plus six desktop/mobile prescription cases |
| Standalone prescription browser suite | **6 passed** in the independent test run, proving fresh bootstrap/login isolation |
| Browser checks | Create/view/revise/recover original/current-status/date order, archived/mismatched context, blank/zero values, dirty cancel/back/reload, >20-version pagination at 10/20/50, no overflow/storage/exceptions |
| Production build | Passed: Worker ~257 kB raw; client JavaScript ~588 kB raw/~178 kB gzip; CSS ~22 kB |
| Existing local migration/repeat | 0005 applied; no migrations pending on second run |
| Preservation checks | Baseline rows/owner/secrets/0001–0004 preserved; interim customer kept; FK check clean |
| Query-plan inspection | Customer list uses covering `idx_prescriptions_customer_history`; chain history uses `idx_prescriptions_history` |
| Dependency audit | **0 vulnerabilities reported** |
| `git diff --check` | Passed |

Backend tests use actual `cloudflare:test`/workerd D1, not mocked SQL results. Scheduling-only race adapters hold genuine reads without substituting data. Browser tests use a fresh temporary local D1 with test-only secrets and the actual Worker/frontend. The unchanged login limiter is respected by reusing a genuine test session through an ignored mode-0600 test artifact. No existing shop DB reset occurs.

Screenshots at ignored `test-results/phase-three-{desktop,mobile}-{form,details,history,paged}.png` were generated and inspected. Browser viewports were 1440×960 and 390×844. Test servers stopped; the user's pre-existing Vite/workerd server was left alone.

## Files created and modified

Created:
- `migrations/0005_prescription_management.sql`
- `shared/prescriptions.ts`, `shared/prescriptionValidation.ts`
- `worker/routes/prescriptions.ts`, `worker/services/prescriptions.ts`, `worker/validators/prescriptions.ts`
- `src/components/PrescriptionHistory.tsx`
- `src/lib/prescriptions.ts`, `src/lib/prescriptionValidation.ts`
- `src/pages/PrescriptionFormPage.tsx`, `src/pages/PrescriptionDetailPage.tsx`
- `test/prescription-validation.test.ts`, `test/prescriptions.test.ts`, `test/prescription-migration.test.ts`, `test/prescription-races.test.ts`
- `e2e/prescriptions.spec.ts`, `e2e/session.ts`
- This report.

Modified for integration:
- `worker/index.ts` (only prescription import/registration).
- `src/App.tsx`, `src/pages/CustomerProfilePage.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/WorkspacePages.tsx`.
- `test/helpers.ts`, `test/database.test.ts`, `test/customers.test.ts`, `test/customer-migration.test.ts` (root fixtures/migration ledger/isolated cleanup; the customer migration suite remains specifically pinned to 0004).
- `e2e/customers.spec.ts` (genuine shared-session helper, real empty prescription section, scoped toast selectors; existing assertions retained).
- `PROJECT_STATUS.md`, README, architecture/recovery/deployment/test documentation and historical report links.

No package/lock/config/auth implementation or old migration change was required.

## Remaining limitations / owner decisions

- This phase supports structured **spectacle** prescriptions only. Broader clinical fields, contact-lens fitting and structured prism support require explicit scope/clinical review.
- New/revised decimal input is limited to two fractional digits. Legacy text/higher precision is preserved verbatim, but a replacement must satisfy the agreed current encoding; there is no silent rounding or interpretation of abbreviations such as PL/DS. Discuss broader precision requirements before relying on such records.
- A correction requires a nonempty reason. Original erroneous values cannot be erased through ordinary UI/SQL writes; formal retention/correction policy needs owner review.
- “Current” is a chain status, not a clinical approval or automatic expiry verdict. Optional dispensing measurements remain the supplied practitioner's/shop's responsibility.
- Independent-root creations are not automatically merged/deduplicated: separate prescriptions can share dates/measurements. UI submission locks exist; API idempotency keys are not introduced in this phase.
- Browser coverage is Chromium desktop/mobile viewports, not Safari/Firefox certification or a mobile-device keyboard audit.
- Existing Free-plan deployed PBKDF2 CPU-budget validation and remote backup/restore rehearsal remain pending. No remote benchmark/deploy or hashing weakening occurred.
- Existing nonblocking Blaze missing-source sourcemap and >500 kB client-chunk warnings remain. No warning suppression was added. Cloudflare Vite preview copies development variables into ignored Worker-side output; these are not public client assets and must never be shared/committed.
- Quotas/storage/paginated limits remain finite; local query plans/tests are not a deployed latency guarantee.

## Exact suggested Git checkpoint

Review all source and untracked files first. Do not stage private variables, backups, local D1, generated assets/traces or the ignored agent board. These commands have **not** been executed:

```bash
git diff --check
git add PROJECT_STATUS.md README.md docs test e2e/customers.spec.ts \
  e2e/prescriptions.spec.ts e2e/session.ts shared/prescriptions.ts \
  shared/prescriptionValidation.ts migrations/0005_prescription_management.sql \
  src/App.tsx src/pages/CustomerProfilePage.tsx src/pages/DashboardPage.tsx \
  src/pages/WorkspacePages.tsx src/components/PrescriptionHistory.tsx \
  src/lib/prescriptions.ts src/lib/prescriptionValidation.ts \
  src/pages/PrescriptionFormPage.tsx src/pages/PrescriptionDetailPage.tsx \
  worker/index.ts worker/routes/prescriptions.ts worker/services/prescriptions.ts \
  worker/validators/prescriptions.ts
git diff --cached --stat
git diff --cached --check
git status --short
git commit -m "feat: implement prescription management module"
```

**Stop condition met: Phase 3 only. Phase 4 requires a separate explicit request.**
