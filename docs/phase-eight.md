# Phase 8 — Final Testing, Deployment & Production Readiness

Verified **5 October 2026**, from clean Phase 7 commit **`ea6f27e feat: implement reports and exports`**.

## 1. Decision and scope

**Local final acceptance is complete. Remote staging and production release remain blocked by explicit approval, account/bindings, deployed KDF CPU and business verification. OptiDesk has not been deployed or approved for production use.**

This final phase verifies the delivered authentication/customer/prescription/purchase/payment/credit/invoice/report application, fixes two reproduced boundary/recovery issues and documents release/recovery gates. No business module, migration, dependency or paid service was added. All test workflows use isolated local D1, not the persistent shop database.

## 2. Actual checks and counts

| Executed gate | Actual result |
|---|---|
| `npm run check` | TypeScript, ESLint, backend tests and production build passed |
| Workerd/D1 (`npm test`, within check) | **1,073 passed across 29 files**, all Phase 1–7 regressions |
| `CI=true WRANGLER_SEND_METRICS=false npm run test:e2e` | Build and **42 real-backend Chromium scenarios passed** |
| Stronger final route/console/resource scenario | Typecheck/lint, focused `CI=true WRANGLER_SEND_METRICS=false npx playwright test e2e/phase-eight.spec.ts` (**1 scenario**) and complete **42-scenario browser/build rerun** passed |
| `npm audit` | **0 vulnerabilities** |
| `git diff --check` | Passed |
| Existing local migration repeat | No migrations to apply |
| Fresh isolated migrations | `0001`–`0009` applied successfully |
| Restored isolated migration repeat | No migrations to apply; nine ledger entries |
| Persistent + recovery integrity | Empty `foreign_key_check`; `quick_check: ok` |
| Original development preservation | All rows/fields/physical rowids/schema/file hashes unchanged; full SQL byte-identical |
| Trusted recovery CLI/checksum | Prepared fixture SQL and standard SHA-256 verification passed |
| Private artifact/source/history review | Passed; seven committed histories and current source reviewed |

The stronger final test was added after the initial 42-scenario run, verified independently and included in the final complete 42-scenario rerun; it does not add another scenario to that count. Existing Blaze missing-source sourcemap warnings, five intentionally induced deferred-FK rollback diagnostics and the client >500 kB chunk warning are nonblocking; related assertions pass. No deployed performance or production-smoke result is inferred from these local checks.

## 3. Security review and concrete JSON fix

- The actual central Worker boundary protects every nonpublic API; health/session/login/secret-gated setup are the four public paths. Unknown API routes return safe JSON, not SPA HTML. Customer/clinical/financial/invoice/report hierarchy checks bind the full UUID context.
- Native PBKDF2-SHA256 remains **600,000 iterations**, random ≥16-byte salts, 256-bit output and validated encoded derivation parameters. The preserved owner hash retains its work factor; no default production password or reset feature was introduced.
- Twelve-hour sessions use HMAC-only stored hashes. HTTPS uses `__Host-optidesk_session`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain; local HTTP uses the existing local name. Existing tests verify expiry, logout isolation, password-change revocation and credential-version races.
- Unsafe requests enforce exact Origin/Fetch Metadata; authenticated mutations additionally require session-bound CSRF. Atomic 15-minute throttles remain 5/email and 20/trusted-IP per operation; tests do not weaken them.
- Strict JSON/path/query schemas, 16 KiB request limits, bound SQL/allowlisted sort identifiers, no-store/security headers and PII-free errors/logging were reviewed and regressions passed. Frontend tokens/drafts remain memory-only; no application browser-storage/service-worker persistence exists.
- A strengthened actual `SELF` test **reproduced** JSON `Content-Type: application/json; charset=utf-8, application/octet-stream`. Blaze's writer checks its capitalized key before adding a stream fallback. `worker/lib/api.ts` now forwards `Content-Type` with that exact case while preserving middleware headers. The exact single JSON header assertion passes in the complete backend suite.
- Known current private secrets were compared in memory against current source, all seven Git histories and built runtime, without printing values. No private-variable/dump/state/result files or private-key markers were committed. Test credential literals and original live-record identifiers were absent from built client/Worker/config files. This is a scoped actual review, not a certification against every unknown secret.

## 4. Migrations and original data preservation

Phase 8 adds **no migration**. All nine committed migrations and private `.dev.vars` hashes remain identical. Existing real local migration repeat reports nothing pending; fresh disposable migration and populated historical migration/failure suites passed. The intentionally staged 0004 customer rebuild and 0005 lineage initialization remain historical verified migrations, not new destructive changes.

| Original persistent table | Before | After |
|---|---:|---:|
| `admin_users` | 1 | 1 |
| `customers` | 1 | 1 |
| `prescriptions` | 1 | 1 |
| `purchases` | 1 | 1 |
| `purchase_items` | 1 | 1 |
| `payments` | 1 | 1 |
| `invoices` | 1 | 1 |
| `invoice_number_reservations` | 1 | 1 |
| `audit_logs` | 9 | 9 |
| `shop_settings` | 1 | 1 |
| `d1_migrations` | 9 | 9 |

Comparison covered **every original non-system table/field/physical rowid**, including security/settings tables, not only these counts. Schema, timestamps, clinical values, financial snapshots, payment ledger, invoice/reservation, audits, shop identity/counter, owner credentials and migration/private-variable hashes were preserved. Full Wrangler before/after SQL exports are byte-identical. FK check is empty and quick check is `ok`.

Evidence: ignored `backups/phase-eight-20261005/{before.sql,after.sql,before-rows.json,baseline-report.json,verified.json,artifact-review.json}`; directory mode 0700, files 0600. These contain confidential records and must remain private. The original baseline was retained. Existing Phase 7 audited live activity was already in this baseline; it was not rolled back or confused with fixtures.

## 5. Full SQL recovery rehearsal and fixes

`e2e/backup-rehearsal.ts` actually exports/checksums all original business schema/data from the live **disposable** browser backend and imports into a **new empty separate local** D1. It compares every business table/field/schema before making intentional recovery changes; it does not pre-apply migrations to the full-dump target.

Two failures were reproduced and resolved:

1. Installed Wrangler **4.147.0** rejects `d1 export --persist-to`. The browser server now uses `<disposable-root>/.wrangler/state`; the export config is created in that root, matching config-relative export behavior. No real development state is redirected or reset.
2. Raw export/import failed with `no such table: main.customers`: physical schema ordering after migration0004 placed prescription data before customer table creation. The offline `maintenance/prepare-recovery.ts` tool uses pinned Wrangler `unstable_splitSqlQuery` to order all tables, dependency-ordered rows/audit anchors, SQLite sequence metadata and original indexes/views/triggers. Its statement-hash multiset verifies nothing is lost/added/rewritten. It never connects to D1 or disables FK; the original backup is retained, output is exclusive mode0600 and unsupported exports fail closed. The real exported `sqlite_sequence` metadata is retained too.

Successful assertions: restored schema/all original business fields; nine migrations/repeat no-op; clean FKs/quick check; revoked restored sessions plus independently rotated **disposable** pepper; old cookie rejected with 401; setup stays closed; genuine login with original fixture password; historical invoice exact equality; audited advancement beyond eight simulated externally printed numbers; new invoice with the reconciled unique number; unchanged source fixtures. Only the helper's own temporary recovery directory is removed.

The focused fixture had one owner/customer/prescription/purchase/item/invoice/reservation/shop, **two payments**, nine audits/migrations and two sessions. These are not persistent-development counts. The complete 42-scenario run also passed recovery with the accumulated earlier browser fixtures. Private local fixture SQL/log/checksum/result files are ignored in `test-results/`.

The offline CLI was exercised separately on the actual fixture dump and its generated standard checksum verified. See [backup and restore](backup-and-restore.md) for the trusted-empty-target procedure. Remote import, Time Travel, large-account quota recovery and production cutover remain unperformed.

## 6. Complete real business workflow

The final scenario uses a real fresh owner login and UI forms/API responses:

1. Save isolated invoice identity, create a customer and a dated prescription with separate OD/OS, PD and quoted/semicolon/multiline original note.
2. Link that fixed prescription to a two-unit frame purchase: 2×₹125.50, ₹0.50 line discount and ₹1.00 order discount = **₹249.50 / 24,950 paise**.
3. Record **₹100 Cash**, verify partial/₹149.50 remaining, then **₹149.50 UPI** and verify paid/₹0.00 outstanding.
4. Generate/reuse the same immutable invoice, invoke native print/A4 PDF and verify ₹249.50 total/zero balance without app chrome.
5. Verify the matching sales report and downloaded CSV show `249.50,249.50,0.00,paid`; the customer is absent from current positive debt.
6. Re-read identical customer/prescription/purchase/item/timestamp/link and payment fields, then perform the full SQL recovery above.

No workflow records were inserted into the persistent shop database or any remote database.

## 7. Invoice and printing regressions

All earlier invoice API/D1 concurrency/retry/audit/rollback/immutability cases passed. One invoice per purchase, permanent consumed reservations, monotonic never-reset numbering and preserved issue-time snapshots remain authoritative; later payments do not rewrite a reprint. Current balances remain separate.

Existing six real invoice Chromium cases passed, including desktop/mobile native `beforeprint`, short A4 and 100-item multi-page output, all lines/repeated headers/final totals, excluded navigation/actions and rasterized ink inside 14 mm margins. Poppler `pdfinfo`, `pdftotext`, `pdftoppm` was already installed; no runtime/npm dependency added. Phase 8 adds another actual native-print/A4 check in its complete workflow. Physical printers, other browsers and legal tax-document requirements remain unverified.

## 8. Frontend final acceptance

The stronger final scenario visits **Dashboard, Customers, Sales & Purchases, Prescriptions, Payments, Reports and Settings** at 1440×960 and 390×844, checks visible headings/no horizontal overflow, unknown-route dashboard fallback, no console/page errors and no missing script/stylesheet responses. Existing authentication/deep-link guards, real loading/empty/error/retry states, clinical/customer unsaved protections, payment stale/lost-response handling, mobile forms/history and all four real CSV downloads passed in the complete suite. No browser persistence was observed. Authenticated data comes from API calls, not public prerendered data or fixtures.

## 9. Production build and artifact review

| Built output | Size | Gzip |
|---|---:|---:|
| Worker `dist/optidesk/index.js` | 320.89 kB | 73.79 kB |
| Client JavaScript | 667.26 kB | 195.79 kB |
| Client CSS | 28.04 kB | 6.47 kB |

Two built HTML asset references resolve; copied static `_headers` matches source. `/api` and `/api/*` execute Worker-first; other navigation uses SPA fallback. Generated config has only approved DB/ASSETS bindings, no secret `vars` and query-redacted/automatic-invocation-log-disabled/trace-disabled observability. No public source maps/secrets/SQL/DB/test credentials/live-record identifiers were found. Vite's ignored server-only `.dev.vars` is outside client assets and must not become a production secret-upload file.

The source/generated DB config still lacks a production UUID; named staging/production environments are deliberately unresolved pending approval. No deploy/dry-run account operation was attempted. Existing chunk and Blaze sourcemap warnings were recorded without a speculative bundling rewrite.

## 10. Query, payload and performance review

Lists/details remain paginated, ordinarily ≤50 rows/page; purchase items ≤100, JSON body ≤16 KiB; report activity ≤366 days; CSV ≤5,000 rows/5 MiB with no silent truncation. The 5,000-row success/5,001-row rejection, overflow and genuine indexed-query regressions passed.

Service statement counts are constant: report summaries/count/details three, payments/dashboard four; purchase creation five batch statements for 1–100 items; invoice reservation and issuance separate three-statement batches. Authentication/context reads add their existing bounded overhead. No per-item/per-result SQL loop was found in reviewed runtime services. Prepared `json_each` retains constant parameter/statement counts; reports aggregate in SQL rather than load the ledger into JavaScript. Existing customer/purchase/payment/history/report indexes are reused, including the real range SEARCH without temporary sort.

Current all-date credit/customer aggregates and leading-wildcard customer searches necessarily read candidate shop rows; bounded returned pages do not eliminate D1 row-read cost. Remote CPU/startup/D1 latency/memory/quota headroom remain unmeasured. No speculative index, cache, business write or architectural rewrite was introduced.

## 11. Current Free-plan verification

Public official sources were rechecked **5 October 2026**: Workers 100,000 dynamic requests/day, **10 ms CPU/request**, 128 MB memory, 50 subrequests; static 20,000 files/25 MiB each; D1 Free 5 million rows read/day, 100,000 written/day, 500 MB/database, 5 GB/account, 10 databases, 50 queries/invocation, 100 bound parameters, 100 KB SQL/2 MB row and seven-day Time Travel. Account quotas are shared. These are public-plan constraints, not proof of the selected account's actual plan/usage or deployed KDF safety.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [SQL import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [Worker metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/). APAC is a placement hint, not guaranteed Indian residency.

## 12. Remote deployment and smoke status

**All remote actions are unperformed.** Exact staged approvals are documented in [deployment](deployment.md):

- Gate A: owner-selected Cloudflare login/account/D1 inspection and actual Free-plan/shared-quota confirmation.
- Gate B: proposed separate `optidesk-staging` Worker/D1, explicit real binding, remote migrations/build/config-review/deploy, independent Worker Secrets and controlled staging setup/removal.
- Gate C: actual native 600,000-iteration setup/login/password-change CPU, repeated warm/practical cold samples, telemetry/p50/p95/max/errors against the 10 ms Free budget, unchanged throttles; staging security/workflow/recovery. Password change includes verify+derive. Stop on failure/inconclusive evidence; no work-factor reduction/paid service/new architecture without approval.
- Gate D: separate production approval for proposed `optidesk` Worker/D1, fresh-versus-existing database/backup/migration/identity review, explicit environment/build/bindings/secrets/actual-owner bootstrap/setup-token removal/deploy and controlled primarily read-only production smoke.

No URL/version/remote D1 UUID, deployed benchmark, remote recovery or production smoke result exists. Missing account/bindings and owner approval are prerequisites, not operations to improvise. A Worker rollback does not roll back D1; full recovery and number reconciliation need separate approval.

## 13. Remaining limitations and readiness blockers

- Actual owner/account/names/origins approval and deployed Free-plan CPU/account quotas are unresolved.
- Local shop identity exists; its preserved GSTIN passes the broad application validator but fails a standard structure check. Owner business verification is required; the application provides no tax engine or GST legal-compliance certification.
- External daily SQL backup scheduling/storage and remote recovery/Time Travel are not configured/rehearsed. Free recovery can be quota-limited; local round-trip proves no remote capacity guarantee.
- Only Chromium desktop/mobile and PDF/native-print output were verified; other browser/device/printer behavior remains open.
- Current credit is live all-date debt, not historical period-end debt; invoices retain issue-time snapshots. Existing Unicode search, unsupported legacy financial/reversal, never-reset numbering and bounded export constraints remain as documented in earlier phase reports.

**Release conclusion: locally verified and prepared for an explicitly approved staging gate; production go-live remains blocked.**

## 14. Exact changed files and Git handoff — not executed

Updated: `PROJECT_STATUS.md`, `README.md`, `docs/architecture.md`, `docs/deployment.md`, `docs/backup-and-restore.md`, `test/README.md`, `worker/lib/api.ts`, `test/request-security.test.ts`, `e2e/session.ts`, `e2e/start-server.mjs`, `tsconfig.node.json`.

Added: `docs/phase-eight.md`, `maintenance/prepare-recovery.ts`, `e2e/backup-rehearsal.ts`, `e2e/phase-eight.spec.ts`.

External confidential comparison/scanning helpers and ignored exports/config/state/cookies/SQL/PDF/CSV/log/trace/result artifacts are not application changes or staging candidates. Historical phase reports and migrations remain intact.

From the repository root, review status/diff/recent history and new files before committing. Proposed commands only:

```bash
git status --short
git diff
git log --oneline -10
git add -- \
  PROJECT_STATUS.md README.md \
  docs/architecture.md docs/deployment.md docs/backup-and-restore.md docs/phase-eight.md \
  test/README.md test/request-security.test.ts \
  worker/lib/api.ts tsconfig.node.json maintenance/prepare-recovery.ts \
  e2e/session.ts e2e/start-server.mjs e2e/backup-rehearsal.ts e2e/phase-eight.spec.ts
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "chore: complete OptiDesk production readiness"
```

No files were staged or committed. Suggested commit message: **`chore: complete OptiDesk production readiness`**; the documented readiness remains explicitly conditional on remote gates.
