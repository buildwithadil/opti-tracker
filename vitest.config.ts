import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

export default defineConfig(async () => ({
  plugins: [cloudflareTest({
    main: './worker/index.ts',
    miniflare: {
      compatibilityDate: '2026-10-01',
      d1Databases: ['DB'],
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        SESSION_PEPPER: 'test-session-pepper-for-optidesk-at-least-32-chars',
        SETUP_TOKEN: 'test-setup-token-for-optidesk',
      },
    },
  })],
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
}))
