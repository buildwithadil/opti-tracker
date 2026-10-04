import { expect, test, type Page } from '@playwright/test'
import type { Prescription, PrescriptionHistory, PrescriptionList } from '../shared/prescriptions'
import { mutationHeaders, signIn } from './session'

async function customer(page: Page, name: string, phone: string) {
  const response = await page.request.post('/api/customers', { headers: await mutationHeaders(page), data: { name, phone } })
  expect(response.status()).toBe(201)
  return (await response.json()).data as { uuid: string; name: string }
}
async function createRecord(page: Page, uuid: string, fields: Record<string, unknown>) {
  const response = await page.request.post(`/api/customers/${uuid}/prescriptions`, { headers: await mutationHeaders(page), data: fields })
  expect(response.status()).toBe(201)
  return (await response.json()).data as Prescription
}
async function readRecord(page: Page, uuid: string, id: string) {
  const response = await page.request.get(`/api/customers/${uuid}/prescriptions/${id}`)
  expect(response.status()).toBe(200)
  return (await response.json()).data as Prescription
}
async function save(page: Page, label: string, path: string, method: string) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === method)
  await page.getByRole('button', { name: label, exact: true }).click()
  const received = await response
  expect(received.status()).toBe(201)
  return (await received.json()).data as Prescription
}
function value(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=following-sibling::dd[1]')
}
async function noOverflowOrStorage(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
}
async function status(page: Page, action: 'Archive' | 'Restore') {
  await page.getByRole('button', { name: `${action} customer`, exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `${action} customer?`, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await dialog.getByRole('button', { name: `${action} customer`, exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

for (const viewport of [
  { label: 'Desktop', width: 1440, height: 960, suffix: '1' },
  { label: 'Mobile', width: 390, height: 844, suffix: '2' },
]) {
  test(`${viewport.label}: actual D1 prescription create/view/revise, immutable previous values, date order and archived/mismatch safety`, async ({ page }) => {
    const failures: string[] = []
    const writes: { path: string; method: string }[] = []
    page.on('pageerror', error => failures.push(error.message))
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.includes('/prescriptions') && request.method() !== 'GET') writes.push({ path, method: request.method() })
    })
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await signIn(page)
    const profile = await customer(page, `${viewport.label} Clinical Profile`, `932456700${viewport.suffix}`)
    const base = `/customers/${profile.uuid}/prescriptions`
    const api = `/api${base}`
    let original!: Prescription
    let replacement!: Prescription
    let unknown!: Prescription

    await test.step('empty real history and strict client validation preserve values without a write', async () => {
      await page.goto(`/customers/${profile.uuid}`)
      await expect(page.getByRole('heading', { name: 'No prescriptions yet', exact: true })).toBeVisible()
      await page.getByRole('link', { name: 'Add prescription', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Add prescription', exact: true })).toBeVisible()
      await expect(page.getByLabel('Prescription date', { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/u)
      for (const label of ['Right SPH (D)', 'Right CYL (D)', 'Right AXIS (°)', 'Right ADD (D)', 'Left SPH (D)',
        'Left CYL (D)', 'Left AXIS (°)', 'Left ADD (D)', 'Distance PD (mm)', 'Near PD (mm)',
        'Right monocular PD (mm)', 'Left monocular PD (mm)', 'Prescriber name', 'Prescription notes', 'Expiry / recheck date']) {
        await expect(page.getByLabel(label, { exact: true })).toHaveValue('')
      }
      await page.getByLabel('Prescription date', { exact: true }).fill('2024-02-29')
      await page.getByLabel('Expiry / recheck date', { exact: true }).fill('2024-02-28')
      // Exercise cross-field dates separately: Zod intentionally does not run
      // object refinements while unrelated measurements fail their base schema.
      await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
      await expect(page.getByLabel('Expiry / recheck date', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByLabel('Expiry / recheck date', { exact: true })).toBeFocused()
      expect(writes).toEqual([])
      await page.getByLabel('Right SPH (D)', { exact: true }).fill('1.234')
      await page.getByLabel('Right AXIS (°)', { exact: true }).fill('181')
      await page.getByLabel('Distance PD (mm)', { exact: true }).fill('0')
      await page.getByLabel('Prescription notes', { exact: true }).fill('Private original notes\nSecond clinical line')
      await page.getByRole('button', { name: 'Save prescription', exact: true }).click()
      for (const label of ['Right SPH (D)', 'Right AXIS (°)', 'Distance PD (mm)']) {
        await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('aria-invalid', 'true')
      }
      await expect(page.getByLabel('Right SPH (D)', { exact: true })).toBeFocused()
      await expect(page.getByLabel('Prescription notes', { exact: true })).toHaveValue('Private original notes\nSecond clinical line')
      expect(writes).toEqual([])
      await noOverflowOrStorage(page)
    })

    await test.step('supplied signed values/zero/optional measurements commit once and survive a genuine reload', async () => {
      const supplied: Record<string, string> = { 'Expiry / recheck date': '2027-02-28', 'Right SPH (D)': '+1.13',
        'Right CYL (D)': '-.5', 'Right AXIS (°)': '0', 'Right ADD (D)': '-0', 'Left SPH (D)': '-2.25',
        'Left AXIS (°)': '180', 'Distance PD (mm)': '63.5', 'Right monocular PD (mm)': '30',
        'Left monocular PD (mm)': '31', 'Prescriber name': '  Dr. Test Clinical  ' }
      for (const [label, input] of Object.entries(supplied)) await page.getByLabel(label, { exact: true }).fill(input)
      await noOverflowOrStorage(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `test-results/phase-three-${viewport.label.toLowerCase()}-form.png`, fullPage: true })
      original = await save(page, 'Save prescription', api, 'POST')
      expect(original).toMatchObject({ customer_uuid: profile.uuid, right_sphere: '+1.13', right_cylinder: '-0.50',
        right_axis: 0, right_addition: '0.00', left_sphere: '-2.25', left_cylinder: null, left_axis: 180,
        left_addition: null, distance_pd: '63.50', near_pd: null, right_pd: '30.00', left_pd: '31.00',
        revision_number: 1, status: 'current', notes: 'Private original notes\nSecond clinical line', prescriber_name: 'Dr. Test Clinical' })
      await expect(page).toHaveURL(new RegExp(`${base}/${original.uuid}$`, 'u'))
      await expect(page.getByRole('heading', { name: 'Prescription details', exact: true })).toBeVisible()
      await expect(value(page, 'Right SPH (D)')).toHaveText('+1.13 D')
      await expect(value(page, 'Right CYL (D)')).toHaveText('-0.50 D')
      await expect(value(page, 'Right AXIS (°)')).toHaveText('0°')
      await expect(value(page, 'Right ADD (D)')).toHaveText('0.00 D')
      await expect(value(page, 'Left CYL (D)')).toHaveText('Unknown')
      await expect(value(page, 'Near PD (mm)')).toHaveText('Unknown')
      await expect(value(page, 'Distance PD (mm)')).toHaveText('63.50 mm')
      await expect(value(page, 'Status')).toHaveText('Current')
      await page.reload()
      await expect(value(page, 'Right SPH (D)')).toHaveText('+1.13 D')
      await expect(page.getByText('Private original notes\nSecond clinical line', { exact: true })).toBeVisible()
      expect(writes).toEqual([{ path: api, method: 'POST' }])
      await noOverflowOrStorage(page)
    })

    await test.step('revision requires a reason and saves a new current version without erasing previous values', async () => {
      await page.getByRole('link', { name: 'Revise prescription', exact: true }).click()
      await expect(page.getByLabel('Right SPH (D)', { exact: true })).toHaveValue('+1.13')
      await expect(page.getByLabel('Right AXIS (°)', { exact: true })).toHaveValue('0')
      await expect(page.getByLabel('Near PD (mm)', { exact: true })).toHaveValue('')
      await page.getByLabel('Right SPH (D)', { exact: true }).fill('-3.13')
      await page.getByRole('button', { name: 'Save revision', exact: true }).click()
      await expect(page.getByLabel('Revision reason', { exact: true })).toHaveAttribute('aria-invalid', 'true')
      expect(writes).toHaveLength(1)
      await page.getByLabel('Prescription date', { exact: true }).fill('2026-04-01')
      await page.getByLabel('Left SPH (D)', { exact: true }).fill('')
      await page.getByLabel('Distance PD (mm)', { exact: true }).fill('')
      await page.getByLabel('Prescription notes', { exact: true }).fill('Replacement-only notes')
      await page.getByLabel('Revision reason', { exact: true }).fill('Correct supplied source record')
      replacement = await save(page, 'Save revision', `${api}/${original.uuid}`, 'PATCH')
      expect(replacement).toMatchObject({ uuid: replacement.uuid, root_uuid: original.uuid, supersedes_uuid: original.uuid,
        revision_number: 2, right_sphere: '-3.13', right_cylinder: '-0.50', right_axis: 0,
        left_sphere: null, distance_pd: null, near_pd: null, right_pd: '30.00', left_pd: '31.00',
        status: 'current', notes: 'Replacement-only notes', revision_reason: 'Correct supplied source record' })
      expect(replacement.uuid).not.toBe(original.uuid)
      await expect(page).toHaveURL(new RegExp(`${base}/${replacement.uuid}$`, 'u'))
      await expect(value(page, 'Version')).toHaveText('2')
      await expect(value(page, 'Status')).toHaveText('Current')
      await expect(value(page, 'Right SPH (D)')).toHaveText('-3.13 D')
      await expect(value(page, 'Left SPH (D)')).toHaveText('Unknown')
      const history = page.getByRole('list', { name: 'Revision history', exact: true })
      await expect(history.getByRole('listitem')).toHaveCount(2)
      await expect(history.getByRole('listitem').nth(0)).toContainText('Version 2')
      await expect(history.getByRole('listitem').nth(1)).toContainText('Version 1')
      await page.getByRole('link', { name: 'View previous version', exact: true }).click()
      await expect(value(page, 'Status')).toHaveText('Superseded')
      await expect(value(page, 'Version')).toHaveText('1')
      await expect(value(page, 'Right SPH (D)')).toHaveText('+1.13 D')
      await expect(value(page, 'Left SPH (D)')).toHaveText('-2.25 D')
      await expect(value(page, 'Distance PD (mm)')).toHaveText('63.50 mm')
      await expect(page.getByText('Private original notes\nSecond clinical line', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Revise prescription', exact: true })).toHaveCount(0)
      expect(await readRecord(page, profile.uuid, original.uuid)).toEqual({ ...original, status: 'superseded',
        superseded_by_uuid: replacement.uuid, superseded_at: replacement.created_at })
      await page.goto(`${base}/${original.uuid}/revise`)
      await expect(page.getByRole('heading', { name: 'Prescription cannot be revised', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save revision', exact: true })).toHaveCount(0)
      await page.goto(`${base}/${original.uuid}`)
      await page.getByRole('link', { name: 'View replacement version', exact: true }).click()
      await expect(value(page, 'Right SPH (D)')).toHaveText('-3.13 D')
      await noOverflowOrStorage(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `test-results/phase-three-${viewport.label.toLowerCase()}-details.png`, fullPage: true })
    })

    await test.step('date-only source does not invent measurements; profile sorts by prescribed date and shows all statuses', async () => {
      await page.getByRole('link', { name: 'Back to customer', exact: true }).click()
      await page.getByRole('link', { name: 'Add prescription', exact: true }).click()
      await page.getByLabel('Prescription date', { exact: true }).fill('2028-01-01')
      unknown = await save(page, 'Save prescription', api, 'POST')
      expect(unknown).toMatchObject({ prescribed_on: '2028-01-01', right_sphere: null, left_sphere: null, right_axis: null,
        left_axis: null, distance_pd: null, near_pd: null, right_pd: null, left_pd: null, prescriber_name: null, notes: null })
      await expect(value(page, 'Right SPH (D)')).toHaveText('Unknown')
      await expect(value(page, 'Right AXIS (°)')).toHaveText('Unknown')
      await page.getByRole('link', { name: 'Back to customer', exact: true }).click()
      const history = page.getByRole('list', { name: 'Prescription history', exact: true })
      await expect(history.getByRole('listitem')).toHaveCount(3)
      expect(await history.locator('time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime'))))
        .toEqual(['2028-01-01', '2026-04-01', '2024-02-29'])
      expect(await history.getByRole('listitem').evaluateAll(elements => elements.map(element => element.textContent?.includes('Superseded') ? 'superseded' : 'current')))
        .toEqual(['current', 'current', 'superseded'])
      await noOverflowOrStorage(page)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: `test-results/phase-three-${viewport.label.toLowerCase()}-history.png`, fullPage: true })
    })

    await test.step('archived direct routes are read-only and wrong customer/item pairing never discloses clinical text', async () => {
      await status(page, 'Archive')
      await expect(page.getByRole('link', { name: 'Add prescription', exact: true })).toHaveCount(0)
      await expect(page.getByRole('list', { name: 'Prescription history', exact: true }).getByRole('listitem')).toHaveCount(3)
      await page.goto(`${base}/new`)
      await expect(page.getByRole('heading', { name: 'Prescription cannot be added', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save prescription', exact: true })).toHaveCount(0)
      await page.goto(`${base}/${replacement.uuid}/revise`)
      await expect(page.getByRole('heading', { name: 'Prescription cannot be revised', exact: true })).toBeVisible()
      await page.goto(`${base}/${replacement.uuid}`)
      await expect(value(page, 'Status')).toHaveText('Current')
      await expect(page.getByRole('link', { name: 'Revise prescription', exact: true })).toHaveCount(0)
      const rejected = await page.request.patch(`${api}/${replacement.uuid}`, { headers: await mutationHeaders(page),
        data: { notes: 'Blocked archived change', revision_reason: 'Must not save' } })
      expect(rejected.status()).toBe(409)
      expect((await rejected.json()).error.code).toBe('CUSTOMER_ARCHIVED')
      expect(await readRecord(page, profile.uuid, replacement.uuid)).toEqual(replacement)
      await page.getByRole('link', { name: 'Back to customer', exact: true }).click()
      await status(page, 'Restore')
      await expect(page.getByRole('link', { name: 'Add prescription', exact: true })).toBeVisible()
      const other = await customer(page, `${viewport.label} Mismatch Profile`, `632456700${viewport.suffix}`)
      const missing = page.waitForResponse(response => new URL(response.url()).pathname === `/api/customers/${other.uuid}/prescriptions/${original.uuid}`)
      await page.goto(`/customers/${other.uuid}/prescriptions/${original.uuid}`)
      expect((await missing).status()).toBe(404)
      await expect(page.getByRole('heading', { name: 'Prescription not found', exact: true })).toBeVisible()
      await expect(page.getByText('Private original notes\nSecond clinical line', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Revise prescription', exact: true })).toHaveCount(0)
      await noOverflowOrStorage(page)
    })
    expect(writes).toEqual([{ path: api, method: 'POST' }, { path: `${api}/${original.uuid}`, method: 'PATCH' }, { path: api, method: 'POST' }])
    expect(failures).toEqual([])
  })

  test(`${viewport.label}: prescription create/revision dirty cancel, internal/back/reload guards cause no writes`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await signIn(page)
    const profile = await customer(page, `${viewport.label} Guard Profile`, `922456700${viewport.suffix}`)
    const base = `/customers/${profile.uuid}/prescriptions`
    const writes: string[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.includes('/prescriptions') && request.method() !== 'GET') writes.push(path)
    })
    await page.goto(`/customers/${profile.uuid}`)
    await page.getByRole('link', { name: 'Add prescription', exact: true }).click()
    await page.getByLabel('Right SPH (D)', { exact: true }).fill('-1.13')
    await page.getByLabel('Prescription notes', { exact: true }).fill('Unsaved private clinical text')
    const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })
    for (const action of ['cancel', 'internal', 'back']) {
      if (action === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      if (action === 'internal') await page.getByRole('link', { name: 'Back to customer', exact: true }).click()
      if (action === 'back') await page.goBack()
      await expect(dialog).toBeVisible()
      expect(await dialog.evaluate(element => element.tagName)).toBe('DIALOG')
      await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`${base}/new$`, 'u'))
      await expect(page.getByLabel('Right SPH (D)', { exact: true })).toHaveValue('-1.13')
      await expect(page.getByLabel('Prescription notes', { exact: true })).toHaveValue('Unsaved private clinical text')
    }
    const prompt = page.waitForEvent('dialog')
    await page.evaluate(() => { setTimeout(() => window.location.reload(), 0) })
    const unload = await prompt
    expect(unload.type()).toBe('beforeunload')
    await unload.dismiss()
    await expect(page.getByLabel('Prescription notes', { exact: true })).toHaveValue('Unsaved private clinical text')
    await noOverflowOrStorage(page)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'No prescriptions yet', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'Add prescription', exact: true }).click()
    await expect(page.getByLabel('Right SPH (D)', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Prescription notes', { exact: true })).toHaveValue('')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    const original = await createRecord(page, profile.uuid, { prescribed_on: '2026-01-01', right_sphere: '-1.25', notes: 'Persisted original' })
    await page.goto(`${base}/${original.uuid}/revise`)
    await page.getByLabel('Right SPH (D)', { exact: true }).fill('+2.13')
    await page.getByLabel('Revision reason', { exact: true }).fill('Unsaved reason')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByLabel('Right SPH (D)', { exact: true })).toHaveValue('+2.13')
    await page.getByRole('link', { name: 'Back to prescription', exact: true }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(value(page, 'Right SPH (D)')).toHaveText('-1.25 D')
    expect(await readRecord(page, profile.uuid, original.uuid)).toEqual(original)
    expect(writes).toEqual([])
    await noOverflowOrStorage(page)
  })

  test(`${viewport.label}: all prescription and revision history is genuinely paged beyond the default twenty`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await signIn(page)
    const profile = await customer(page, `${viewport.label} Paged Clinical Profile`, `942456700${viewport.suffix}`)
    const base = `/customers/${profile.uuid}/prescriptions`
    const headers = await mutationHeaders(page)
    const original = await createRecord(page, profile.uuid, { prescribed_on: '2025-01-01', right_sphere: '+0.13', notes: 'Original paged source' })
    let current = original
    for (let revision = 2; revision <= 21; revision++) {
      const response = await page.request.patch(`/api${base}/${current.uuid}`, { headers,
        data: { right_sphere: `${revision}.13`, revision_reason: `Source revision ${revision}` } })
      expect(response.status()).toBe(201)
      current = (await response.json()).data as Prescription
      expect(current.revision_number).toBe(revision)
    }
    const independent = await createRecord(page, profile.uuid, { prescribed_on: '2090-01-01' })
    const listed = await page.request.get(`/api${base}?pageSize=50`)
    expect(listed.status()).toBe(200)
    const list = (await listed.json()).data as PrescriptionList
    expect(list.pagination.total).toBe(22)
    expect(list.prescriptions[0].uuid).toBe(independent.uuid)
    await page.goto(`/customers/${profile.uuid}`)
    const history = page.getByRole('list', { name: 'Prescription history', exact: true })
    const pagination = page.getByRole('navigation', { name: 'Prescription history pagination', exact: true })
    await expect(history.getByRole('listitem')).toHaveCount(20)
    await expect(pagination.getByRole('status')).toHaveText('1–20 of 22 versions · Page 1 of 2')
    await expect(pagination.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled()
    await pagination.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await expect(pagination.getByRole('status')).toHaveText('21–22 of 22 versions · Page 2 of 2')
    await expect(pagination.getByRole('button', { name: 'Next', exact: true })).toBeDisabled()
    await expect(pagination.getByRole('button', { name: 'Previous', exact: true })).toBeEnabled()
    const pageTwo = await history.getByRole('link').evaluateAll(elements => elements.map(element => element.getAttribute('href')))
    expect(pageTwo).toEqual(list.prescriptions.slice(20).map(row => `${base}/${row.uuid}`))
    await pagination.getByLabel('Per page').selectOption('50')
    await expect(history.getByRole('listitem')).toHaveCount(22)
    await expect(pagination.getByRole('status')).toHaveText('1–22 of 22 versions · Page 1 of 1')
    await page.goto(`${base}/${current.uuid}`)
    const chain = page.getByRole('list', { name: 'Revision history', exact: true })
    const chainPagination = page.getByRole('navigation', { name: 'Revision history pagination', exact: true })
    await expect(chain.getByRole('listitem')).toHaveCount(20)
    await expect(chain.getByRole('listitem').first()).toContainText('Version 21')
    await chainPagination.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(chain.getByRole('listitem')).toHaveCount(1)
    await expect(chain.getByRole('listitem').first()).toContainText('Version 1')
    await expect(chain.getByRole('link')).toHaveAttribute('href', `${base}/${original.uuid}`)
    await expect(chainPagination.getByRole('status')).toHaveText('21–21 of 21 versions · Page 2 of 2')
    await chainPagination.getByLabel('Per page').selectOption('10')
    await expect(chain.getByRole('listitem')).toHaveCount(10)
    await expect(chain.getByRole('listitem').first()).toContainText('Version 21')
    await chainPagination.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(chain.getByRole('listitem').first()).toContainText('Version 11')
    await chainPagination.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(chain.getByRole('listitem')).toHaveCount(1)
    await expect(chain.getByRole('listitem').first()).toContainText('Version 1')
    await chainPagination.getByLabel('Per page').selectOption('50')
    await expect(chain.getByRole('listitem')).toHaveCount(21)
    await expect(chain.getByText('Current', { exact: true })).toHaveCount(1)
    await expect(chain.getByText('Superseded', { exact: true })).toHaveCount(20)
    const response = await page.request.get(`/api${base}/${original.uuid}/history?pageSize=50`)
    expect(response.status()).toBe(200)
    const dto = (await response.json()).data as PrescriptionHistory
    expect(dto.prescriptions.map(row => row.revision_number)).toEqual(Array.from({ length: 21 }, (_, index) => 21 - index))
    expect(dto.prescriptions.at(-1)).toMatchObject({ uuid: original.uuid, right_sphere: '+0.13', notes: 'Original paged source' })
    await noOverflowOrStorage(page)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `test-results/phase-three-${viewport.label.toLowerCase()}-paged.png`, fullPage: true })
  })
}
