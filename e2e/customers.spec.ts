import { expect, test, type Page } from '@playwright/test'
import { signIn } from './session'

function results(page: Page, mobile: boolean) {
  return mobile ? page.getByRole('list', { name: 'Customer search results' }) : page.getByRole('table', { name: 'Customer search results' })
}
async function openCreate(page: Page) {
  await page.getByRole('link', { name: 'Add Customer', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Add Customer', exact: true })).toBeVisible()
}
async function search(page: Page, value: string) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/customers' && response.request().method() === 'GET' && new URL(response.url()).searchParams.get('search') === value)
  await page.getByLabel('Search customers').fill(value)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  expect((await response).status()).toBe(200)
}
async function submit(page: Page, label: string, path: string, method: string, expectedStatus = 200) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method)
  await page.getByRole('button', { name: label, exact: true }).click()
  const received = await response
  expect(received.status()).toBe(expectedStatus)
  return received
}
async function confirmStatus(page: Page, action: 'Archive' | 'Restore', path: string, expectedStatus = 200) {
  await page.getByRole('button', { name: `${action} customer`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `${action} customer?`, exact: true })
  await expect(dialog).toBeVisible()
  // Native dialogs contain focus and keep cancellation as the safe default.
  expect(await dialog.evaluate(element => element.tagName)).toBe('DIALOG')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  const response = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === (action === 'Archive' ? 'DELETE' : 'POST'))
  await dialog.getByRole('button', { name: `${action} customer`, exact: true }).click()
  const received = await response
  expect(received.status()).toBe(expectedStatus)
  if (expectedStatus === 200) await expect(dialog).not.toBeVisible()
  return { dialog, response: received }
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

for (const viewport of [
  { label: 'Desktop', width: 1440, height: 960, mobile: false, suffix: '1' },
  { label: 'Mobile', width: 390, height: 844, mobile: true, suffix: '2' },
]) {
  test(`${viewport.label}: real customer CRUD, literal/phone search, profile, archive, restore and conflicts`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const pageErrors: string[] = []
    const mutations: { path: string; method: string }[] = []
    const requests: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/')) requests.push(path)
      if (path.startsWith('/api/customers') && request.method() !== 'GET') mutations.push({ path, method: request.method() })
    })
    await signIn(page)
    const originalName = `${viewport.label} Literal %_\\ Profile`
    const editedName = `${viewport.label} Edited %_\\ Profile`
    const firstNational = `912345600${viewport.suffix}`
    const editedNational = `623456700${viewport.suffix}`
    const resolvedNational = `723456700${viewport.suffix}`
    let uuid = ''

    await test.step('strict client validation and normalized real creation', async () => {
      await openCreate(page)
      await page.getByLabel('Full name', { exact: true }).fill('   ')
      await page.getByLabel('Mobile number', { exact: true }).fill('+1 9876543210')
      await page.getByRole('button', { name: 'Save customer', exact: true }).click()
      await expect(page.getByLabel('Full name', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByLabel('Mobile number', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      expect(mutations).toEqual([])
      await page.getByLabel('Full name', { exact: true }).fill(`  ${viewport.label === 'Desktop' ? 'Ｄesktop' : 'Ｍobile'}   Literal %_\\ Profile  `)
      await page.getByLabel('Mobile number', { exact: true }).fill(`0091-${firstNational.slice(0, 5)} ${firstNational.slice(5)}`)
      const response = await submit(page, 'Save customer', '/api/customers', 'POST', 201)
      const envelope = await response.json() as { data: { uuid: string; name: string; normalized_phone: string; archived_at: null } }
      expect(envelope.data).toMatchObject({ name: originalName, normalized_phone: `+91${firstNational}`, archived_at: null })
      uuid = envelope.data.uuid
      await expect(page).toHaveURL(new RegExp(`/customers/${uuid}$`, 'u'))
      await expect(page.getByRole('heading', { name: originalName, exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: `+91 ${firstNational.slice(0, 5)} ${firstNational.slice(5)}`, exact: true })).toHaveAttribute('href', `tel:+91${firstNational}`)
      await expect(page.getByRole('heading', { name: 'Purchase history', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Prescription history', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'No prescriptions yet', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Add prescription', exact: true })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'No purchases yet', exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Add purchase', exact: true })).toBeVisible()
      expect(mutations.filter(request => request.path === '/api/customers' && request.method === 'POST')).toHaveLength(1)
      await page.reload()
      await expect(page.getByRole('heading', { name: originalName, exact: true })).toBeVisible()
      await noOverflow(page)
    })

    await test.step('literal wildcard, case-insensitive name, equivalent full phone and partial phone searching', async () => {
      await page.getByRole('link', { name: 'Back to customers', exact: true }).click()
      for (const value of [`${viewport.label} Literal %_\\`, `${viewport.label.toLowerCase()} literal`, `0-${firstNational.slice(0, 5)}-${firstNational.slice(5)}`, firstNational.slice(3, 8)]) {
        await search(page, value)
        await expect(results(page, viewport.mobile).getByRole('link', { name: originalName, exact: true })).toBeVisible()
        await expect(page.getByRole('status')).toHaveText('1 customer')
      }
      await results(page, viewport.mobile).getByRole('link', { name: `View ${originalName}`, exact: true }).click()
      await expect(page.getByRole('heading', { name: originalName, exact: true })).toBeVisible()
    })

    await test.step('edit has a real dirty cancel guard and persists normalized changes', async () => {
      await page.getByRole('link', { name: 'Edit customer', exact: true }).click()
      await page.getByLabel('Full name', { exact: true }).fill(editedName)
      await page.getByLabel('Mobile number', { exact: true }).fill(`0 ${editedNational.slice(0, 5)}-${editedNational.slice(5)}`)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(editedName)
      const response = await submit(page, 'Save changes', `/api/customers/${uuid}`, 'PATCH')
      expect((await response.json()).data).toMatchObject({ uuid, name: editedName, normalized_phone: `+91${editedNational}` })
      await expect(page.getByRole('heading', { name: editedName, exact: true })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'Customer details saved.' })).toContainText('Customer details saved.')
    })

    await test.step('duplicate active phone is a real 409 inline conflict retaining form data', async () => {
      await page.getByRole('link', { name: 'Back to customers', exact: true }).click()
      await openCreate(page)
      await page.getByLabel('Full name', { exact: true }).fill(`${viewport.label} Duplicate must not exist`)
      await page.getByLabel('Mobile number', { exact: true }).fill(`0091-${editedNational.slice(0, 5)} ${editedNational.slice(5)}`)
      const response = await submit(page, 'Save customer', '/api/customers', 'POST', 409)
      expect((await response.json()).error.code).toBe('CUSTOMER_PHONE_CONFLICT')
      await expect(page.getByLabel('Mobile number', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      // Keep this an actual failing assertion, but continue the remaining
      // lifecycle steps so an accessibility defect cannot hide CRUD failures.
      await expect.soft(page.getByLabel('Mobile number', { exact: true })).toBeFocused()
      await expect(page.getByText('This mobile number is already in use by an active customer.', { exact: true })).toBeVisible()
      await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(`${viewport.label} Duplicate must not exist`)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click()
      await search(page, editedNational)
      await expect(page.getByRole('status')).toHaveText('1 customer')
      await results(page, viewport.mobile).getByRole('link', { name: editedName, exact: true }).click()
    })

    await test.step('archive confirmation is cancellable; archived listing/profile survive reload and restore', async () => {
      await page.getByRole('button', { name: 'Archive customer', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Archive customer?', exact: true })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(page.getByRole('button', { name: 'Archive customer', exact: true })).toBeFocused()
      await confirmStatus(page, 'Archive', `/api/customers/${uuid}`)
      await expect(page.getByText('Archived', { exact: true }).first()).toBeVisible()
      await page.reload()
      await expect(page.getByRole('button', { name: 'Restore customer', exact: true })).toBeVisible()
      await page.getByRole('link', { name: 'Back to customers', exact: true }).click()
      await search(page, editedNational)
      await expect(page.getByRole('heading', { name: 'No matching customers', exact: true })).toBeVisible()
      await page.getByLabel('Customer status').selectOption('archived')
      await expect(results(page, viewport.mobile).getByRole('link', { name: editedName, exact: true })).toBeVisible()
      await expect(page.getByRole('status')).toHaveText('1 customer')
      await results(page, viewport.mobile).getByRole('link', { name: editedName, exact: true }).click()
      await confirmStatus(page, 'Restore', `/api/customers/${uuid}/restore`)
      await expect(page.getByRole('status').filter({ hasText: 'Customer restored to the active list.' })).toContainText('Customer restored to the active list.')
      await expect(page.getByRole('button', { name: 'Archive customer', exact: true })).toBeVisible()
    })

    await test.step('phone reuse causes real restore conflict, and an archived edit resolves it without implicitly restoring', async () => {
      await confirmStatus(page, 'Archive', `/api/customers/${uuid}`)
      await page.getByRole('link', { name: 'Back to customers', exact: true }).click()
      await openCreate(page)
      await page.getByLabel('Full name', { exact: true }).fill(`${viewport.label} Replacement`)
      await page.getByLabel('Mobile number', { exact: true }).fill(`91${editedNational}`)
      await submit(page, 'Save customer', '/api/customers', 'POST', 201)
      await expect(page.getByRole('heading', { name: `${viewport.label} Replacement`, exact: true })).toBeVisible()
      await page.goto(`/customers/${uuid}`)
      await expect(page.getByRole('button', { name: 'Restore customer', exact: true })).toBeVisible()
      const { dialog, response } = await confirmStatus(page, 'Restore', `/api/customers/${uuid}/restore`, 409)
      expect((await response.json()).error.code).toBe('CUSTOMER_PHONE_CONFLICT')
      await expect(dialog.getByRole('alert')).toContainText('An active customer already uses this mobile number.')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.getByRole('link', { name: 'Edit customer', exact: true }).click()
      await expect(page.getByText('This customer is archived. You can update contact details here; saving does not restore the profile.', { exact: true })).toBeVisible()
      await page.getByLabel('Mobile number', { exact: true }).fill(`+91 ${resolvedNational.slice(0, 5)} ${resolvedNational.slice(5)}`)
      const saved = await submit(page, 'Save changes', `/api/customers/${uuid}`, 'PATCH')
      expect((await saved.json()).data.archived_at).not.toBeNull()
      await expect(page.getByRole('button', { name: 'Restore customer', exact: true })).toBeVisible()
      await confirmStatus(page, 'Restore', `/api/customers/${uuid}/restore`)
      await page.getByRole('link', { name: 'Back to customers', exact: true }).click()
      await search(page, viewport.label)
      await page.getByLabel('Customer status').selectOption('all')
      await page.getByLabel('Sort by').selectOption('name')
      await page.getByLabel('Sort order').selectOption('asc')
      await expect(page.getByRole('status')).toHaveText('2 customers')
      await expect(results(page, viewport.mobile).getByRole('link', { name: editedName, exact: true })).toBeVisible()
      await expect(results(page, viewport.mobile).getByRole('link', { name: `${viewport.label} Replacement`, exact: true })).toBeVisible()
      await page.goto(`/customers?${new URLSearchParams({ search: viewport.label, status: 'all', sort: 'name', order: 'asc', pageSize: '1' })}`)
      await expect(page.getByLabel('Per page')).toHaveValue('1')
      await expect(results(page, viewport.mobile).getByRole('link', { name: editedName, exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(results(page, viewport.mobile).getByRole('link', { name: `${viewport.label} Replacement`, exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Previous', exact: true }).click()
      await expect(results(page, viewport.mobile).getByRole('link', { name: editedName, exact: true })).toBeVisible()
      await noOverflow(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `test-results/phase-two-${viewport.label.toLowerCase()}.png`, fullPage: true })
    })

    expect(pageErrors).toEqual([])
    expect(requests.every(path => path.startsWith('/api/customers') || ['/api/auth/session', '/api/auth/setup', '/api/auth/login', '/api/shop/identity', '/api/reports/dashboard'].includes(path))).toBe(true)
    expect(mutations.filter(request => request.method === 'PATCH')).toHaveLength(2)
    expect(mutations.filter(request => request.method === 'DELETE' && request.path === `/api/customers/${uuid}`)).toHaveLength(2)
    expect(mutations.filter(request => request.path.endsWith('/restore'))).toHaveLength(3)
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
  })

  test(`${viewport.label}: unsaved creation guards cancel, internal navigation, back and reload without customer writes`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    const mutationPaths: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.startsWith('/api/customers') && request.method() !== 'GET') mutationPaths.push(path)
    })
    await signIn(page)
    await openCreate(page)
    const name = `${viewport.label} Unsaved customer`
    await page.getByLabel('Full name', { exact: true }).fill(name)
    await page.getByLabel('Mobile number', { exact: true }).fill('9876543210')
    const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })

    await test.step('cancel and internal links retain changes when declined', async () => {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(page).toHaveURL(/\/customers\/new$/u)
      await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(name)
      if (viewport.mobile) {
        await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
        await page.getByRole('navigation', { name: 'Mobile primary navigation', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click()
      } else {
        await page.getByRole('navigation', { name: 'Primary navigation', exact: true }).getByRole('link', { name: 'Dashboard', exact: true }).click()
      }
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(name)
    })

    await test.step('history back is blocked and Keep editing preserves the current URL/form', async () => {
      await page.goBack()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(page).toHaveURL(/\/customers\/new$/u)
      await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(name)
    })

    await test.step('real browser beforeunload cancellation preserves dirty form', async () => {
      const prompt = page.waitForEvent('dialog')
      // A dismissed beforeunload deliberately produces no load event; don't
      // wait for one through page.reload(). Trigger the real browser reload.
      await page.evaluate(() => { setTimeout(() => window.location.reload(), 0) })
      const unload = await prompt
      expect(unload.type()).toBe('beforeunload')
      await unload.dismiss()
      await expect(page).toHaveURL(/\/customers\/new$/u)
      await expect(page.getByLabel('Full name', { exact: true })).toHaveValue(name)
    })

    await test.step('explicit discard navigates and a newly opened form is clean', async () => {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeVisible()
      await noOverflow(page)
      await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible()
      await openCreate(page)
      await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('')
      await expect(page.getByLabel('Mobile number', { exact: true })).toHaveValue('')
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Customers', exact: true })).toBeVisible()
      await expect(dialog).not.toBeVisible()
    })
    expect(mutationPaths).toEqual([])
  })
}
