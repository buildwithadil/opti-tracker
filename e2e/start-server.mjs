import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

// Disposable, LOCAL-only database and deliberately test-only configuration.
const directory = mkdtempSync(join(tmpdir(), 'optidesk-browser-tests-'))
process.once('exit', () => rmSync(directory, { recursive: true, force: true }))
const secrets = join(directory, 'test.env')
writeFileSync(secrets, 'SESSION_PEPPER=test-session-pepper-for-optidesk-at-least-32-chars\nSETUP_TOKEN=test-setup-token-for-optidesk\n', { mode: 0o600 })
const common = ['--config', 'e2e/wrangler.jsonc', '--persist-to', directory]
const migration = spawnSync('node', ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'optidesk-browser-test-db', '--local', ...common], {
  stdio: 'inherit', env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
})
if (migration.status !== 0) process.exit(migration.status ?? 1)
const server = spawn('node', ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', ...common, '--env-file', secrets, '--port', '8789', '--ip', '127.0.0.1', '--show-interactive-dev-session', 'false'], {
  stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal))
server.on('exit', (code) => process.exit(code ?? 0))
