# OptiDesk project status

Last verified: 4 October 2026. Current handoff: Phase 3.

## Current stage

**Phase 3 — Prescription Management: implemented and locally verified.**

Committed Phases 1–2 remain functional. Phase 4 has not started. This is not a complete optical-shop business release or an approved production deployment.

## Delivered

- Phase 1: single-owner setup/login/session/logout/password changes, exact-Origin/CSRF protections, throttling, security headers and responsive neutral shell.
- Phase 2: authenticated customer CRUD/search/pagination/sorting, canonical Indian mobile uniqueness, archive/restore, atomic administrator audits and responsive profiles/forms.
- Phase 3: customer-linked spectacle prescription creation/details/history; separate OD/OS SPH/CYL/AXIS/ADD; prescription date, optional expiry/recheck, prescriber/notes, distance/near/monocular PD; exact signed decimals and explicit unknown/null values.
- Append-only prescription revisions with root/parent/version/reason, database lineage/immutability guards, derived current/superseded status and complete paginated revision history.
- Atomic creation/supersede/revise audits with minimal metadata, preserved original clinical values, stale-race protection and customer-context isolation.
- Desktop/mobile create/detail/revision/history, double-submit protection and unsaved cancel/navigation/back/reload warnings.
- Archived customers retain read-only prescriptions until restored. Purchase history and future financial/reporting modules remain explicitly unavailable.

## Latest actual checks

The complete parent-run command succeeded:

```bash
npm run check && npm run test:e2e && git diff --check && npm audit
```

| Gate | Result |
|---|---|
| TypeScript | Passed |
| ESLint | Passed |
| Actual workerd/D1 tests | **797 passed across 15 files**, including all original 536 tests |
| Full real-backend Chromium suite | **11 passed**, including Phase 1/2 regressions and six desktop/mobile prescription cases |
| Production build | Passed |
| Dependency audit | **0 vulnerabilities reported** |
| `git diff --check` | Passed |
| Existing local D1 migration | `0005_prescription_management.sql` applied (14 commands); repeat had no pending migrations |
| Preservation verification | Baseline rows/owner/secrets/0001–0004 intact; foreign keys clean; interim customer addition retained |

Populated migration, independent FK/index/lineage checks, all-column/no-op immutability, audit-failure rollback, concurrent same-parent revisions, archived-customer races, list/history snapshots, optional/null/zero/signed values, date/axis validation, and mismatched customer context passed. Browser checks cover full lifecycle, original-value recovery, dirty forms and >20-version pagination at page sizes 10/20/50.

At preservation-check time, the existing local database had one owner, one customer and zero prescriptions/purchases/payments. The customer was added during development before the migration and was **not reset to the initial empty snapshot**. Test clinical records remain confined to disposable databases. An ignored private SQLite backup/verification record exists under `backups/phase-three-before-20261004T095532Z/`.

## Database and API

Phase 3 appends ALTER statements to the existing prescription table; it does not rebuild it or change prior migrations. Stable `prescriptions(id)` values continue to be referenced by future purchase/item foreign keys; `customer_id` references the existing `customers(uuid)`.

New fields: `root_id`, `supersedes_id`, `revision_number`, `revision_reason`, `near_pd`. A root owns its UUID, and each successor follows its same-customer parent by one version. Unique successor/root-version slots and insert guards prevent branches/cycles/reassignment; all prescription rows reject UPDATE/DELETE. Legacy payloads and timestamps are preserved verbatim.

Authenticated APIs:
- `GET /api/customers/:customerUuid/prescriptions`
- `POST /api/customers/:customerUuid/prescriptions`
- `GET /api/customers/:customerUuid/prescriptions/:prescriptionUuid`
- `PATCH /api/customers/:customerUuid/prescriptions/:prescriptionUuid` — inserts a replacement, HTTP 201
- `GET /api/customers/:customerUuid/prescriptions/:prescriptionUuid/history`

Each item/history/revision query binds both UUIDs. API JSON aliases the established DB `id`/`customer_id` fields as `uuid`/`customer_uuid`. Existing customer/auth endpoints remain unchanged.

## Validation and clinical scope

- New prescription date required; optional expiry cannot precede it.
- Blank/omitted/null measurements remain unknown; explicit zero is retained.
- SPH/CYL/ADD accept signed exact decimal input, up to two fractional digits and six whole digits as a technical encoding bound—not a clinical normal range. Excess precision is rejected, not rounded.
- Optional AXIS is an integer 0–180, matching the existing schema. CYL/AXIS pairing is not forced.
- PD is an optional positive decimal in mm. Typical adult/child ranges, near subtraction and monocular sums are not inferred/enforced.
- Revisions require a reason and preserve earlier immutable rows.
- New structured entries/revisions support spectacle prescriptions. Legacy contact-lens/other records remain readable; specialized fitting/structured prism fields are outside scope.
- “Current” means latest within a chain, not a clinical recommendation or expiry approval. Owner/optometrist review is needed before real clinical use and before broadening supported precision/types.

## Remaining risks

- Existing Cloudflare Free-plan deployed PBKDF2 CPU compliance and remote backup/restore rehearsal remain unverified; no work factor was lowered.
- Existing name-search Unicode/candidate-scan and finite shared quota limitations remain.
- Nonblocking Blaze sourcemap and >500 kB client-chunk build warnings remain documented.
- Only Chromium at desktop/mobile viewports was run; broader browsers/devices are not certified.
- Original erroneous clinical values cannot be erased through normal module operations. Broader precision, retention/correction policy and specialized optical fields need explicit review.
- No API idempotency keys/automatic independent-root deduplication are added; real UI submission locks are implemented.

## Not performed

No remote provisioning/migration/export/restore/deployment, paid-service activation, dependency addition, image upload, R2/external storage, secret regeneration, local DB reset or Git commit occurred. Authentication code and `.dev.vars` files are unchanged. The pre-existing user dev server was left running; test servers stopped.

## Stop condition

**Phase 3 only. Phase 4 has not started and requires explicit approval.** Purchases, payments, invoices, taxes, financial metrics, reports, exports and editable shop settings remain future phases.

## Documentation

- [Architecture](docs/architecture.md)
- [Phase 1 — historical](docs/phase-one.md)
- [Phase 2 — historical](docs/phase-two.md)
- [Phase 3 implementation report](docs/phase-three.md)
- [Deployment prerequisites](docs/deployment.md)
- [Backup/restore runbook](docs/backup-and-restore.md)
