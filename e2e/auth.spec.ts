import { expect, test } from '@playwright/test'

const password = 'Test-only owner passphrase 2026'
const replacement = 'Replacement test-only passphrase 2026'
const email = 'owner@example.test'

test('owner setup, real sessions, navigation, password change, and mobile access', async ({ page, context }) => {
  const failures: string[] = []
  const apiPaths = new Set<string>()
  page.on('pageerror', error => failures.push(error.message))
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/')) {
      apiPaths.add(path)
      // Phase 2 makes only the customer list available in this auth workflow.
      if (path === '/api/customers') expect(request.method()).toBe('GET')
    }
  })

  await test.step('static assets and API misses use security headers and safe JSON', async () => {
    const asset = await context.request.get('/')
    expect(asset.status()).toBe(200)
    expect(asset.headers()['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(asset.headers()['x-content-type-options']).toBe('nosniff')
    const miss = await context.request.get('/api/unknown-route')
    expect(miss.status()).toBe(401)
    expect(miss.headers()['content-type']).toContain('application/json')
    expect((await miss.json()).error.code).toBe('AUTH_REQUIRED')
  })

  await test.step('initial setup requires confirmation and the deployment secret', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Set up administrator access' })).toBeVisible()
    await page.getByLabel('Administrator name', { exact: true }).fill('Test owner')
    await page.getByLabel('Email address', { exact: true }).fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password', { exact: true }).fill('different test passphrase')
    await page.getByLabel('Setup secret', { exact: true }).fill('test-setup-token-for-optidesk')
    await page.getByRole('button', { name: 'Complete one-time setup' }).click()
    await expect(page.getByText('Passwords must match.')).toBeVisible()
    await page.getByLabel('Confirm password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Complete one-time setup' }).click()
    await expect(page.getByRole('heading', { name: 'Workspace readiness' })).toBeVisible()
    const cookies = await context.cookies()
    const session = cookies.find(cookie => cookie.name === 'optidesk_session')
    expect(session?.httpOnly).toBe(true)
    expect(session?.sameSite).toBe('Lax')
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  })

  await test.step('all seven desktop routes work without mock stats or unavailable API calls', async () => {
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Workspace readiness' })).toBeVisible()
    const navigation = page.getByRole('navigation', { name: 'Primary navigation', exact: true })
    for (const name of ['Customers', 'Sales & Purchases', 'Prescriptions', 'Payments', 'Reports', 'Settings', 'Dashboard']) {
      await navigation.getByRole('link', { name, exact: true }).click()
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.getByText('The server returned an unexpected response.')).toHaveCount(0)
    }
    await page.screenshot({ path: 'test-results/phase-one-desktop.png', fullPage: true })
  })

  await test.step('password change revokes the current session and accepts only the new password', async () => {
    await page.goto('/settings')
    await page.getByLabel('Current password', { exact: true }).fill(password)
    await page.getByLabel('New password', { exact: true }).fill(replacement)
    await page.getByLabel('Confirm new password', { exact: true }).fill(replacement)
    await page.getByRole('button', { name: 'Change password and sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Administrator sign in' })).toBeVisible()
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.')
    await page.getByLabel('Password', { exact: true }).fill(replacement)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Workspace readiness' })).toBeVisible()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Administrator sign in' })).toBeVisible()
  })

  await test.step('mobile navigation is keyboard accessible and has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByLabel('Email address').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(replacement)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Workspace readiness' })).toBeVisible()
    const trigger = page.getByRole('button', { name: 'Open navigation' })
    await trigger.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.getByRole('navigation', { name: 'Mobile primary navigation' }).getByRole('link', { name: 'Customers', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/phase-one-mobile.png', fullPage: true })
  })
  expect(failures).toEqual([])
  expect([...apiPaths].every(path => [
    '/api/auth/session', '/api/auth/setup', '/api/auth/login',
    '/api/auth/logout', '/api/auth/change-password', '/api/shop/identity', '/api/shop/invoice-identity', '/api/customers',
  ].includes(path))).toBe(true)
})
