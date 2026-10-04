# Phase 1 backend tests

Run `npm test` from the project root. These tests execute in **workerd** through the installed Cloudflare Vitest integration; HTTP tests call the actual worker via `cloudflare:test`'s `SELF` binding and database tests use its real D1 binding. No Node-only D1 mock or router mock is used.

The root Vitest configuration supplies `TEST_MIGRATIONS`, `DB`, `SESSION_PEPPER`, and `SETUP_TOKEN`. The installed package is `@cloudflare/vitest-plugin` (the newer package exposing `cloudflare:test`, rather than the older `@cloudflare/vitest-pool-workers`). `test/helpers.ts` contains references to its installed runtime types.

- `auth.test.ts`: bootstrap race and singleton ownership, normalized identity, secure cookies and independently derived session/CSRF fingerprints, login, expiry/revocation, logout isolation, and password changes.
- `request-security.test.ts`: Origin/Fetch Metadata enforcement, session-bound CSRF on unsafe methods, JSON/schema validation, the 16 KiB byte/stream/declared-size boundary, security headers, and non-sensitive error responses/logging.
- `rate-limits.test.ts`: atomic per-email/per-IP reservations, trusted CF IP handling, spoofed forwarding headers, window reset, concurrent attempts, bootstrap limits, and password-guessing limits.
- `database.test.ts`: all three real migrations, foreign keys and transactional batch rollback, owner/shop singletons, active-phone uniqueness, retained immutable invoice numbers, payment/customer consistency, and append-only audits.
- `crypto.test.ts`: independently checked workerd PBKDF2/HMAC derivations, random salts/tokens, malformed-hash rejection, and safe derivation parameters.
- `configuration-and-races.test.ts`: fail-closed secret configuration, credential-version guarded session insertion, and safe JSON rejection of future API routes.
- `utilities.test.ts`: integer-paise arithmetic/tax rounding, overflow rejection, human-text normalization, and canonical UTC date checks.

## Database isolation

Each database-backed file resets Cloudflare bindings and applies the migrations once in `beforeAll`. Before each individual test, the fixture removes only test rows in child-first order with foreign keys enabled. To permit fixture cleanup, it temporarily drops the existing audit-delete and issued-invoice-delete triggers, then restores their **original migration SQL** in `finally`. It does not recreate missing triggers or install substitutes that could hide a migration defect. Audit-update enforcement stays enabled throughout. Migration-ledger rows are retained, and the database suite explicitly checks the required triggers and idempotent migration application.

The tests are intentionally serial per the root configuration. Avoid `.concurrent` test declarations that would share and reset the same D1 binding. The concurrent bootstrap/login assertions instead send concurrent HTTP requests *within* one isolated test.
