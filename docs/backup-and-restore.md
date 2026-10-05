# Backup and restore runbook

## Current status

No external backup scheduler or backup storage is provisioned. Nothing is sent to R2, a third-party database, or a paid service. This document is a recovery procedure, **not a claim that backups are already running**. Phase 6 delivers invoice generation/printing only; authenticated CSV business exports remain future work and are unavailable.

## What and how often

1. **D1 Time Travel:** always on for production-backend D1 databases. Free-plan retention is **seven days**, not thirty days. Cloudflare automatically records recoverable history; no manual schedule is required. It remains within the same Cloudflare account and is not an independent/off-account backup.
2. **Full SQL export:** recommended at the end of each trading day and immediately before migrations. Owner/maintainer initiates it on a trusted computer after closing data entry. It includes schema, customers, prescriptions, purchases/items, payments/reversals, immutable invoices/number reservations, settings, owner password hash, session hashes, and audit events. Printed invoices/PDFs are not equivalent to a full relational backup; future CSVs also cannot replace it.
3. **Offline retention recommendation:** keep seven daily, eight weekly, and twelve monthly encrypted copies on owner-controlled existing storage. No retention automation has been installed. An optional local scheduler can run only while that computer is powered on and connected; failure alerts and routine checks remain necessary.

Cloudflare export blocks other database requests while it runs. Use a quiet maintenance window. Exports/imports/verification queries consume D1 quotas. The free database cap is 500 MB even though the account cap is 5 GB.

## Full SQL export

Use the pinned project Wrangler from a trusted authenticated terminal; no Cloudflare admin API token belongs in the browser.

```bash
mkdir -p "$HOME/OptiDeskBackups"
chmod 700 "$HOME/OptiDeskBackups"
file="$HOME/OptiDeskBackups/optidesk-$(date -u +%Y%m%dT%H%M%SZ).sql"
npx wrangler d1 export <production-database-name> --remote --output="$file"
chmod 600 "$file"
shasum -a 256 "$file" > "$file.sha256"
```

Replace the placeholder with the explicitly approved production database name. Encrypt/protect backups with the owner's established disk encryption/private backup process. Never commit dumps or hashes of passwords/session records to Git. Keep application source and versioned migrations separately; Worker secrets and Cloudflare resource bindings are **not contained in a SQL export** and require a private recovery record/password manager.

Do not use `DB.dump()` or legacy `wrangler d1 backup` commands: they concern old alpha databases. Avoid FTS5/other virtual tables without a verified export strategy; current documented SQL export limitations affect virtual tables.

## Restore an export: preferred safe procedure

Restoration always needs explicit owner approval and a maintenance window.

1. Stop application writes. Save a fresh export and the current Time Travel bookmark. Identify the application version and migration history matching the backup.
2. Check the saved SHA-256 checksum. Use a **new empty test/recovery D1 database**, not an ordinary import into the live populated database. `d1 execute --file` executes SQL; it does not magically replace an existing database.
3. Import schema and data into the empty target:

   ```bash
   npx wrangler d1 execute <empty-recovery-database> --remote --file=<trusted-export.sql>
   ```

   Do not pre-apply all migrations before a full schema+data dump. Reconcile `d1_migrations` with the restored schema and matching code release before applying subsequent migrations. Converted raw SQLite dumps may need `BEGIN`/`COMMIT` removed per D1 documentation. SQL is executable code: only import trusted backups.
4. Verify integrity, foreign keys, row counts, prescription roots/parent chains/version uniqueness and original clinical values, invoice uniqueness, customer totals, line-item tax totals, and effective payment/reversal balances. Do not declare a restoration successful from an HTTP 200 alone.
5. Revoke/delete restored sessions. Configure fresh Worker secrets separately; a restored password hash preserves the old password until changed.
6. **Reconcile externally printed invoices/payment receipts after the restore point.** Restoring old data can restore an older invoice sequence. Recover missing records and advance the sequence before reopening writes so invoice numbers already given to customers are never reused. Phase 6 uses `shop_settings.next_invoice_number` with the existing prefix/padding, plus permanent `invoice_number_reservations` and immutable `invoices`. Advance beyond every issued/reserved/externally printed sequence and reconcile legacy `purchases.invoice_number` collisions too. Unused committed reservations are intentional gaps, not reusable numbers. Do not delete ledger rows, decrement counters, reset a financial year or automatically regenerate old snapshots. Counter/index/namespace guards provide fail-closed protection but cannot discover documents missing from an old backup; owner-maintainer reconciliation is still necessary.
7. Bind a test/staging Worker to the recovered database and perform read-only checks. Once approved, point the production binding at the verified recovery target and deploy the matching code release. Keep the prior database temporarily for rollback; never delete it as part of an automatic script.
8. Reopen writes only after administrator login, historical invoice retrieval, and financial reconciliation checks pass. Take a new independent export.

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

Phase 1–6 migration and transactional tests run against disposable local D1. Populated preservation tests retain original fields/rowids/timestamps/FKs, clinical and immutable financial records. Phase 6 additionally verifies numbering races, permanent unused reservations, immutable snapshots, atomic rollback and repeated migration. Private exports precede actual local upgrades; 0008 before/after verification retained every existing original row/column/rowid, earlier migrations and private variables. This does not constitute a remote SQL export/import or Time Travel rehearsal. Remote export/import/Time Travel procedures have not been executed because there is no approved production account/database. A full backup round-trip and recovery rehearsal are release gates before business go-live.

Sources:
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
