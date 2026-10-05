import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// auth.spec.ts runs first and replaces this test-only owner's password. Each
// clinical/customer spec also works independently: bootstrap only when the
// actual disposable backend reports setupRequired, otherwise sign in normally.
const email = 'owner@example.test'
const password = 'Replacement test-only passphrase 2026'
// Reuse a genuine session in an ignored per-run mode0600 artifact, never browser
// storage or a mocked identity. The unchanged five/email login limit stays on;
// auth consumes three slots and this shared artifact avoids redundant logins
// across spec files or Playwright worker restarts. outputDir is cleared per run.
let cookies: Awaited<ReturnType<BrowserContext['cookies']>> | undefined

export async function signIn(page: Page) {
  const outputDirectory = test.info().project.outputDir
  const cookieArtifact = join(outputDirectory, 'customer-test-session.json')
  if (!cookies && existsSync(cookieArtifact)) {
    cookies = JSON.parse(readFileSync(cookieArtifact, 'utf8')) as typeof cookies
  }
  if (cookies) await page.context().addCookies(cookies)
  const response = await page.request.get('/api/auth/session')
  expect(response.status()).toBe(200)
  const session = await response.json() as { success: boolean; data: { authenticated: boolean; setupRequired?: boolean } }
  expect(session.success).toBe(true)
  await page.goto('/customers')
  if (session.data.setupRequired) {
    await expect(page.getByRole('heading', { name: 'Set up administrator access' })).toBeVisible()
    await page.getByLabel('Administrator name', { exact: true }).fill('Test owner')
    await page.getByLabel('Email address', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password', { exact: true }).fill(password)
    await page.getByLabel('Setup secret', { exact: true }).fill('test-setup-token-for-optidesk')
    await page.getByRole('button', { name: 'Complete one-time setup' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  } else if (!session.data.authenticated) {
    await expect(page.getByRole('heading', { name: 'Administrator sign in' })).toBeVisible()
    await page.getByLabel('Email address', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible()
  }
  cookies = await page.context().cookies()
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(cookieArtifact, JSON.stringify(cookies), { mode: 0o600 })
  await page.goto('/customers')
  await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible()
  await expect(page.getByLabel('Customer status')).toHaveValue('active')
}

/** Every request goes to the real local disposable Worker/D1 webServer. */
export async function mutationHeaders(page: Page) {
  const response = await page.request.get('/api/auth/session')
  expect(response.status()).toBe(200)
  const session = await response.json() as { success: boolean; data: { authenticated: boolean; csrfToken: string } }
  expect(session.success).toBe(true)
  expect(session.data.authenticated).toBe(true)
  return { Origin: new URL(page.url()).origin, 'X-CSRF-Token': session.data.csrfToken }
}
