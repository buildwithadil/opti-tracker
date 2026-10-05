# Deployment runbook — remote actions not yet approved or executed

Verified 5 October 2026. Phases 1–7 are delivered and Phase 8 **local** acceptance/security/recovery passed: 1,073 workerd/D1 tests, 42 real-backend Chromium scenarios, build/typecheck/lint/audit and exact original-data preservation. This does not approve production use. No Cloudflare login/account inspection, remote resource/migration/secret operation, deployment or production smoke was performed.

## Before any remote operation

- Obtain explicit owner approval for the **exact** account inspection/resource names/configuration, remote migrations, secrets, bootstrap, benchmark and deployment actions. Approval of local work is not remote approval. Present filled-in commands again when account/database IDs and origins are known.
- Verify the selected account remains on Workers/D1 **Free**, with available shared request/read/write/storage/database/cron capacity. Do not enable a paid plan or service.
- Keep staging and production D1, Worker secrets and origins separate. Use only isolated nonproduction records in staging; never attach production data to development/browser tests.
- Pass deployed native PBKDF2 CPU measurement and staging acceptance/recovery before production provisioning/deployment.
- Have the owner confirm shop identity, GSTIN and actual tax/document requirements. Existing local identity is populated; its GSTIN passes the application's broad format but fails a standard GSTIN structure check. It was preserved, not certified or changed. New purchases have no tax engine; there is no legal GST-compliance claim.

The source `wrangler.jsonc` has **no D1 `database_id` or named staging/production bindings**. There is no approved account/origin. The commands below are a proposed gated procedure, not an executable authorization. Ordinary `npm run deploy`, `db:migrate:remote` and `db:export` are remote actions and remain blocked.

## Current public Free-plan constraints

Official limits/pricing were rechecked on 5 October 2026:

| Resource | Free constraint relevant to OptiDesk |
|---|---|
| Workers | 100,000 dynamic requests/day; **10 ms CPU/request**; 128 MB memory; 50 subrequests/request |
| Static assets | Free/unlimited direct asset requests; 20,000 files; 25 MiB/file |
| D1 daily usage | 5 million rows read, 100,000 rows written; indexes also affect billed row writes |
| D1 storage | 10 databases/account; 500 MB/database; 5 GB/account |
| D1 invocation/SQL | 50 queries/invocation; 100 bound parameters; 100 KB statement; 2 MB row; 30-second query limit |
| Recovery | Seven-day Free Time Travel; independent exports remain necessary |

Actual account plan/shared usage, deployed CPU, latency and request billing behavior have **not** been verified. See [official Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). APAC is only a placement hint; it does not guarantee Indian residency.

## Gate A — proposed account inspection

Request permission to authenticate and inspect the owner-selected account only:

```bash
npx wrangler login
npx wrangler whoami
npx wrangler d1 list
```

Confirm the account ID, Free plan and shared usage in the account dashboard, including existing Workers/D1/cron allocations. Record the approved account and names before any provisioning. These commands have not been run.

## Gate B — proposed isolated staging

Proposed names for owner confirmation: Worker **`optidesk-staging`**, D1 **`optidesk-staging`**, named environment **`staging`**, free workers.dev origin assigned by the approved account. Using installed Wrangler **4.147.0**, request approval to create only that database:

```bash
npx wrangler d1 create optidesk-staging --location=apac --update-config=false
```

After approval, explicitly add the returned real ID to `env.staging.d1_databases` (`binding: DB`, approved name, `migrations_dir: migrations`), the approved Worker name/account, SPA/ASSETS configuration and PII-safe observability. D1 bindings are not inherited into named environments. Disable public preview URLs in the approved release configuration. Do not use `e2e/wrangler.jsonc` or fixture UUIDs for deployment; do not permit automatic D1 provisioning.

Once the concrete binding/configuration is reviewed, request approval for these staging operations:

```bash
npx wrangler d1 migrations list optidesk-staging --remote --config wrangler.jsonc --env staging
npx wrangler d1 migrations apply optidesk-staging --remote --config wrangler.jsonc --env staging
CLOUDFLARE_ENV=staging npm run build
# Inspect the generated config and .wrangler/deploy/config.json target FIRST.
npx wrangler deploy
npx wrangler secret put SESSION_PEPPER --config wrangler.jsonc --env staging --name optidesk-staging
npx wrangler secret put SETUP_TOKEN --config wrangler.jsonc --env staging --name optidesk-staging
```

The Vite plugin selects the named environment **at build time** using `CLOUDFLARE_ENV`; Wrangler deploy follows the generated deployment pointer. Verify the exact account/name/D1 UUID, API-first asset routes and selected output before executing deploy. Do not build another environment between inspection and deployment. The initial staging Worker has no setup secret until the approved secret operations; fail-closed configuration is expected, not a release success.

## Secrets and bootstrap

Generate independent secrets privately (`openssl rand -base64 32`) and enter them through interactive Cloudflare Worker Secret prompts for the explicit approved target. Never use `vars`, `VITE_*`, Git, command-line secret values, a public static file or test defaults. Vite copies development `.dev.vars` into ignored **server-only** build output; it is outside public assets and must not be passed as a production `--secrets-file` or copied into a release archive.

Perform controlled HTTPS setup only on the approved origin with owner-controlled credentials. Setup is permanently closed once the singleton owner exists. After successful bootstrap, the specifically approved staging removal command is:

```bash
npx wrangler secret delete SETUP_TOKEN --config wrangler.jsonc --env staging --name optidesk-staging
```

Verify setup remains disabled afterward. Rotate `SESSION_PEPPER` only deliberately: all existing session/CSRF hashes become invalid and users must sign in again; password hashes remain usable. Production gets independent secrets and the real owner, not a copied staging account/database.

There is no public registration or automatic email/SMS password reset integration. Recovery requires a trusted maintainer with Cloudflare access, a verified owner identity, an audited maintenance procedure, and session revocation. Do not invent an emergency default password.

## Gate C — deployed native KDF and staging acceptance

Keep the supported **600,000-iteration native PBKDF2-SHA256** derivation unchanged. Setup derives one hash, login verifies one, and password change verifies the current password then derives another. Measure real success and invalid-login paths, not only health/static requests.

1. Collect action-isolated staging CPU telemetry, sample counts, p50/p95/max, status/error rates, D1 timings and UTC measurement windows. If telemetry cannot distinguish credential paths, the result is inconclusive and remains a blocker. Do not enable raw password/body/PII request logging for measurement.
2. Repeat warm requests and practical cold requests after approved fresh deployment/idle periods; record the method and its limitations. Local workerd wall time and `curl` elapsed time are not deployed CPU evidence.
3. Keep actual 15-minute throttles enabled: 5/email and 20/trusted-IP per operation. Space samples across windows instead of clearing production/staging throttle tables or spoofing trusted headers.
4. Require the observed credential paths to fit the **10 ms/request Free budget with operating margin**, with no CPU-limit failures. A percentile alone cannot excuse over-budget worst-case credential calls.
5. Run staging HTTPS cookie/Origin/CSRF/expiry/revocation/security checks, all desktop/mobile business routes, exact payments/invoice/reprint/native A4/CSV reports and an independently approved remote SQL recovery drill into a separately named empty staging-recovery D1. Measure representative business/100-item invoice/report/CSV CPU and latency plus actual D1 rows read/written. Any larger fixture volume must be explicitly approved and fit remaining shared Free quotas; small-result measurements do not establish maximum-export safety.

**Stop if any gate fails or cannot be measured.** Report actual CPU results and seek explicit architecture approval for a verified Free-plan solution; do not lower work factor, add infrastructure or activate a paid plan automatically. No deployed KDF result currently exists.

## Gate D — production migration, deployment and bootstrap

Only after staging success, request separate production approval. Proposed names: Worker **`optidesk`**, D1 **`optidesk`**, explicit environment **`production`**. Confirm fresh installation versus an existing approved database/independent restore, actual identity, migration history, maintenance window, prior Worker version and SQL/Time Travel rollback references. Never copy staging fixtures into production.

For an explicitly approved fresh production database only:

```bash
npx wrangler d1 create optidesk --location=apac --update-config=false
```

Bind its real ID explicitly in `env.production`; never create a replacement by guess if an existing shop database exists. Take a private export before any existing-database upgrade.

After approval and a fresh independent database export, review all active and archived legacy customer phone values before applying 0004. Unsupported formats or canonical active-number collisions deliberately abort it; do not skip constraints or merge/delete records to force a migration.

Phase 3's 0005 migration preserves existing prescription payloads/UUID references and adds irreversible ordinary-application UPDATE/DELETE guards. Review clinical precision/type/retention needs and backups before applying to another populated database. Revisions append replacement rows; there is no hard-delete maintenance UI.

Phase 4/5's 0006/0007 preserve immutable purchase/payment rows; 0008 adds immutable invoices/reservations; 0009 adds only a report index. Only never-reset numbering is supported. After a restore, reconcile legacy/reserved/issued/externally printed numbers and advance the shop counter before reopening writes. See the [recovery runbook](backup-and-restore.md). Phase 8 adds no migration.

After the actual production binding, backups and exact commands are approved:

```bash
npx wrangler d1 migrations list optidesk --remote --config wrangler.jsonc --env production
npx wrangler d1 migrations apply optidesk --remote --config wrangler.jsonc --env production
CLOUDFLARE_ENV=production npm run build
# Review exact generated account/name/bindings/assets/deployment pointer FIRST.
npx wrangler deploy
npx wrangler secret put SESSION_PEPPER --config wrangler.jsonc --env production --name optidesk
# Fresh installation only; then controlled actual-owner setup:
npx wrangler secret put SETUP_TOKEN --config wrangler.jsonc --env production --name optidesk
npx wrangler secret delete SETUP_TOKEN --config wrangler.jsonc --env production --name optidesk
```

The secret deletion follows successful actual-owner bootstrap, not the preceding command immediately. Existing owners require their existing approved secret/recovery policy, not a new setup attempt. Vite currently generates `dist/optidesk/wrangler.json`; inspect the path/config generated by each named build. Do not edit old migrations, import a full dump into a populated live database or treat a Worker rollback as a DB rollback. Keep the previous Worker version/database for an approved recovery; no automatic deletion is authorized.

## Post-deploy release checks

- Exact-origin login/setup and secure session-cookie attributes on HTTPS.
- Unauthorized GET/mutations to every sensitive endpoint return safe JSON rejection.
- CSRF rejection and rate-limit behavior under concurrent requests.
- No customer data in public asset output, caches, logs, or browser persistence.
- Correct D1 binding and effective password/session invalidation.
- Reports/dashboard and all four authenticated CSV downloads have accurate live totals, safe formula handling and no clinical/private-note leakage.
- Complete customer→prescription→purchase→partial/final payments→invoice→reports workflow on staging. Production smoke is owner-approved and primarily read-only; any business write must be a specifically approved real record, not an accidental test invoice/customer/payment.
- Native A4 printing including multi-page line-item tables on desktop and mobile.
- Backup download/restore drill and current quota/storage tracking.

A free workers.dev address needs no paid custom domain. Optional domain registration has its own cost. No recurring paid integration is required by the proposed application, but unlimited availability/storage cannot be promised within finite free-tier quotas.

Record actual Worker URL/version, D1 UUID/migration ledger, secure-cookie/security/CPU smoke results, setup-secret removal and private independent backup receipt after deployment. All of these remote results are currently **unperformed**, not inferred from local acceptance.
