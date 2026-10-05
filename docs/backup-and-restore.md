# Backup and restore runbook

## Current status

Verified 5 October 2026. No external backup scheduler/storage is provisioned. This is a recovery procedure, **not a claim that scheduled backups are running**. Phase 7 delivers authenticated sales/payments/outstanding/category CSVs; they are business extracts, not recovery backups. Phase 8 actually passed a full SQL export/import, session recovery and invoice-sequence rehearsal using separate disposable **local** D1 databases. Remote SQL recovery and Time Travel remain unperformed and require exact owner approval.

## What and how often

1. **D1 Time Travel:** always on for production-backend D1 databases. Free-plan retention is **seven days**, not thirty days. Cloudflare automatically records recoverable history; no manual schedule is required. It remains within the same Cloudflare account and is not an independent/off-account backup.
2. **Full SQL export:** recommended at the end of each trading day and immediately before migrations. Owner/maintainer initiates it on a trusted computer after closing data entry. It includes schema, migration ledger, customers, prescriptions, purchases/items, payments/reversals, immutable invoices/number reservations, settings, owner password hash, session hashes and audit events. Printed invoices/PDFs and current report CSVs cannot replace it.
3. **Offline retention recommendation:** keep seven daily, eight weekly, and twelve monthly encrypted copies on owner-controlled existing storage. No retention automation has been installed. An optional local scheduler can run only while that computer is powered on and connected; failure alerts and routine checks remain necessary.

Cloudflare export blocks other database requests while it runs. Use a quiet maintenance window. Exports/imports/verification queries consume D1 quotas. The free database cap is 500 MB even though the account cap is 5 GB.

## Full SQL export

Use pinned Wrangler **4.147.0** from a trusted authenticated terminal. First approve the exact source account/database/environment/output action; no Cloudflare admin API token belongs in the browser. The following references a future approved `production` binding from the [deployment runbook](deployment.md), which is not currently configured:

```bash
umask 077
mkdir -p "$HOME/OptiDeskBackups"
chmod 700 "$HOME/OptiDeskBackups"
file="$HOME/OptiDeskBackups/optidesk-$(date -u +%Y%m%dT%H%M%SZ).sql"
npx wrangler d1 export optidesk --remote --config wrangler.jsonc --env production --output="$file"
chmod 600 "$file"
shasum -a 256 "$file" > "$file.sha256"
```

Use only the explicitly approved real production source. `umask 077` protects the export and checksum at creation. Encrypt/protect backups with the owner's established disk encryption/private backup process. Never commit dumps or password/session records to Git. Keep application source and versioned migrations separately; Worker secrets and Cloudflare resource bindings are **not contained in SQL** and require a private recovery record/password manager.

Installed Wrangler `d1 export` has **no `--persist-to` option**. A local export resolves state relative to its configuration directory (`.wrangler/state/v3/d1`). The browser recovery helper creates a temporary export config beside the disposable state; normal local preservation exports use the repository config. Never accidentally export/import the real development database while testing recovery.

Do not use `DB.dump()` or legacy `wrangler d1 backup` commands: they concern old alpha databases. Avoid FTS5/other virtual tables without a verified export strategy; current documented SQL export limitations affect virtual tables.

## Restore an export: preferred safe procedure

Restoration always needs explicit owner approval and a maintenance window.

1. Stop application writes. Save a fresh export and the current Time Travel bookmark. Identify the application version and migration history matching the backup.
2. Check the saved SHA-256 checksum. Use a **new empty test/recovery D1 database**, not an ordinary import into the live populated database. `d1 execute --file` executes SQL; it does not magically replace an existing database.
3. **Prepare the trusted full export offline before importing.** The earlier 0004 customer-table rebuild changes physical schema order. A raw Wrangler dump can insert prescriptions before `customers` exists; the actual Phase 8 raw-import attempt failed with `no such table: main.customers`. Do not disable foreign keys or pre-migrate a full-dump target to bypass that failure.

   After verifying the original checksum (`shasum -a 256 -c "$file.sha256"`), prepare a separate new private file with Node 24 and the pinned project dependencies:

   ```bash
   node maintenance/prepare-recovery.ts <trusted-export.sql> <new-private-prepared.sql>
   shasum -a 256 -c <new-private-prepared.sql>.sha256
   ```

   This offline tool performs no D1/network operation. It recognizes the current full 18-table export, orders tables first and original data by dependencies (including audit anchors), retains SQLite autoincrement sequence metadata, and creates original indexes/views/triggers afterward. It preserves the original SQL statement multiset with SHA-256 assertions; it does not rewrite row values or disable foreign keys. Input is never overwritten; output/checksum are created exclusively with mode0600. Unsupported dumps fail closed. SQL is executable code: this is not a sanitizer for untrusted files. Retain and verify both original and prepared checksums.
4. After **separate explicit approval** of the exact empty recovery database/account/config, import the prepared schema+data:

   ```bash
    npx wrangler d1 execute <approved-empty-recovery-database> --remote --config <approved-recovery-config> --file=<new-private-prepared.sql>
   ```

    Do not pre-apply migrations before a full schema+data dump. Reconcile `d1_migrations` with the restored schema/matching code release; a restored current dump has nine entries and repeat migrations report nothing pending. Arbitrary converted SQLite/other-version dumps require separately verified handling; do not edit old migrations or force unsupported statements through this preparer.
5. Verify `PRAGMA foreign_key_check` is empty and `PRAGMA quick_check` is `ok`; compare table/schema/count/original-field manifests, clinical roots/parent chains/version uniqueness, invoice/reservation/legacy-number uniqueness, customer totals, original tax totals and effective payment/reversal balances. The business manifests must include archived records and audit history. An HTTP 200 is not restoration proof.
6. Revoke restored sessions with an explicitly approved maintenance statement and rotate only the target Worker pepper through Worker Secrets. Confirm the old cookie is rejected and setup remains disabled; do not reopen bootstrap for an existing owner. A restored password hash preserves the old password. Verify genuine owner login before cutover; never reset it to a default/test password.
7. **Reconcile externally printed invoices/payment receipts after the restore point.** Restoring old data can restore an older invoice sequence. Recover missing records and advance the sequence before reopening writes so numbers already given to customers are never reused. Use `shop_settings.next_invoice_number`, existing prefix/padding, permanent `invoice_number_reservations` and immutable `invoices`; reconcile legacy `purchases.invoice_number` too. Advance beyond every issued/reserved/externally printed sequence and append an owner-associated reconciliation audit. Unused reservations remain gaps. Do not delete ledger rows, decrement/reset counters or automatically regenerate old snapshots. Guards cannot discover documents missing from an old backup; owner-maintainer reconciliation remains necessary.
8. Bind an approved staging/recovery Worker and verify original-password login, read-only historical invoice equality and financial totals. Any recovery-test writes occur only on a disposable validation target, not accidentally on the recovery database intended for production cutover. Once separately approved, point production at the verified target and matching release; retain the prior database for rollback.
9. Reopen writes only after login, old-session denial, historical invoice and financial/number reconciliation pass. Take a new independent export. Do not create an unintended production invoice merely to test the sequence.

Large imports may exceed daily free write quotas. Do not promise arbitrarily large one-day restores or silently purchase a plan. Split imports only using a tested relationship-preserving procedure; explain any quota-related delay to the owner.

## Time Travel incident recovery

```bash
npx wrangler d1 info <production-database-name>
npx wrangler d1 time-travel info <production-database-name>
npx wrangler d1 time-travel info <production-database-name> --timestamp="<UTC-RFC3339-time>"
# Only after approval, fresh export, bookmark capture, and maintenance shutdown:
npx wrangler d1 time-travel restore <production-database-name> --bookmark="<verified-bookmark>"
```

Time Travel overwrites the live database in place and cancels in-flight queries. The response provides a prior bookmark for undo. Free retention is seven days; maximum ten restores per ten minutes/database. Time Travel does not currently provide cloning/forking. Perform the same invoice-sequence, record, code-version, secret/session, and financial reconciliation steps before reopening. No normal application UI will expose destructive database restores.

## Verification status

Phase 1–7 migration/transactional tests passed in actual disposable workerd/D1. Phase 8's real browser workflow additionally passed a full trusted Wrangler export/checksum/prepared import into an **empty local target**, exact all-business-schema/field equality, nine restored migrations/repeat no-op, clean FK/quick check, restored original-password login, stale-cookie rejection after session revocation/disposable pepper rotation, unchanged historical invoice, an audited simulated eight-number external gap and a unique later invoice. The source fixture database stayed unchanged. Quoted/semicolon/multiline clinical notes were retained exactly.

Actual persistent development preservation: one owner/customer/prescription/purchase/item/payment/invoice/reservation/shop, nine audits and nine migrations; all original physical rowids/fields/schema, migration/private-variable hashes and byte-identical full before/after SQL were verified. Private directory `backups/phase-eight-20261005/` is mode0700, evidence files mode0600. Disposable recovery exports/logs/results are ignored under `test-results/` and are not backups of production. Remote export/import/Time Travel, external scheduling, account capacity and production cutover have **not** been verified. See [Phase 8](phase-eight.md).

Sources:
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
