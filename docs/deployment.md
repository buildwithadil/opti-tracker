# Deployment prerequisites — not yet executed

OptiDesk Phase 1 is locally testable. A complete business release and production deployment have not been approved or performed.

## Before any remote operation

- Finish all eight phases and the acceptance checks.
- Obtain explicit owner approval for account provisioning, remote migrations, and deployment.
- Use a separate staging D1 database and never attach production data to a local dev/test session.
- Recheck current Workers/D1 Free limits and the account's shared usage.
- Benchmark native PBKDF2 password setup/login/change on a **Free-plan staging Worker**, including CPU telemetry and repeated cold/warm requests. Local workerd permits work factors that do not prove the deployed 10 ms budget. Do not lower the work factor, claim it is free-tier-safe, or silently activate a paid plan. If it fails, propose a verified free-tier design (for example a small free SQLite-backed Durable Object used only for the KDF, after architecture approval) before changing infrastructure.
- Rehearse an SQL export/import restore and invoice sequence reconciliation.
- Supply actual GST/tax/HSN/invoice settings and have the business verify its document requirements. This application does not make a legal tax-compliance claim.

## Explicit provisioning and bindings

After approval, using the exact installed Wrangler:

```bash
npx wrangler login
npx wrangler d1 create <approved-database-name> --location=apac
```

Copy the returned `database_id` and actual name to `wrangler.jsonc`. `apac` is a hint and does not guarantee Indian residency. Do not use the browser-test configuration for deployment. Remove/disable public preview URLs for production or verify that every preview has separate authorized bindings and secrets.

D1 bindings are not inherited into named environments; define staging/production bindings explicitly if environments are introduced. Vite's Cloudflare plugin selects its environment at build time using `CLOUDFLARE_ENV`. Avoid mixing a staging frontend output configuration with a production database.

## Secrets and bootstrap

Generate independent secrets privately and store them using Cloudflare Worker Secrets, never `vars`, Vite-prefixed variables, or committed `.env` files:

```bash
npx wrangler secret put SESSION_PEPPER
npx wrangler secret put SETUP_TOKEN
```

Initial owner setup needs the supplied secret and is closed permanently when an owner row exists. Remove `SETUP_TOKEN` after successful bootstrap; its absence disables setup. Rotate `SESSION_PEPPER` only deliberately: all existing session/CSRF hashes become invalid and users must sign in again. Password hashes remain usable.

There is no public registration or automatic email/SMS password reset integration. Recovery requires a trusted maintainer with Cloudflare access, a verified owner identity, an audited maintenance procedure, and session revocation. Do not invent an emergency default password.

## Migration and deployment sequence

After approval and a fresh independent database export:

```bash
npx wrangler d1 migrations list <approved-database-name> --remote
npx wrangler d1 migrations apply <approved-database-name> --remote
npm run check
npm run test:e2e
npm run build
npx wrangler deploy
```

Vite generates `dist/optidesk/wrangler.json` referencing the built client assets. Inspect that generated binding/configuration before deployment. Do not edit old migrations, import a full SQL dump into a populated live database, or treat a Worker code rollback as a database rollback.

## Post-deploy release checks

- Exact-origin login/setup and secure session-cookie attributes on HTTPS.
- Unauthorized GET/mutations to every sensitive endpoint return safe JSON rejection.
- CSRF rejection and rate-limit behavior under concurrent requests.
- No customer data in public asset output, caches, logs, or browser persistence.
- Correct D1 binding and effective password/session invalidation.
- Every customer→prescription→purchase→payment→invoice workflow on staging and approved production smoke checks.
- Native A4 printing including multi-page line-item tables on desktop and mobile.
- Backup download/restore drill and current quota/storage tracking.

A free workers.dev address needs no paid custom domain. Optional domain registration has its own cost. No recurring paid integration is required by the proposed application, but unlimited availability/storage cannot be promised within finite free-tier quotas.
