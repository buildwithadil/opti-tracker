import { expect, test, type Page } from '@playwright/test'
import type { PaymentCreated, PaymentList } from '../shared/payments'
import type { PurchaseDetail } from '../shared/purchases'
import { mutationHeaders, signIn } from './session'

async function fixture(page: Page, name: string, phone: string, total = '5000.00') {
  const headers = await mutationHeaders(page)
  const response = await page.request.post('/api/customers', { headers, data: { name, phone } })
  expect(response.status()).toBe(201)
  const customer = (await response.json()).data as { uuid: string }
  const purchase = await addPurchase(page, customer.uuid, total)
  return { customer, purchase }
}
async function addPurchase(page: Page, customerUuid: string, total: string) {
  const response = await page.request.post(`/api/customers/${customerUuid}/purchases`, { headers: await mutationHeaders(page), data: {
    client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', items: [{ description: 'Original payment-test frame', product_category: 'spectacle_frames', quantity: 1, unit_price: total }],
  } })
  expect(response.status()).toBe(201)
  return (await response.json()).data as PurchaseDetail
}
const api = (customerUuid: string, purchaseUuid: string) => `/api/customers/${customerUuid}/purchases/${purchaseUuid}/payments`
async function apiPayment(page: Page, customerUuid: string, purchaseUuid: string, amount: string) {
  const response = await page.request.post(api(customerUuid, purchaseUuid), { headers: await mutationHeaders(page), data: { client_request_id: crypto.randomUUID(), amount, payment_method: 'cash' } })
  expect(response.status()).toBe(201)
}
async function layout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
}
async function save(page: Page, path: string, twice = false) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST')
  if (twice) await page.getByRole('form', { name: 'Record payment', exact: true }).evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  else await page.getByRole('button', { name: 'Save payment', exact: true }).click()
  const response = await pending
  expect(response.status()).toBe(201)
  return (await response.json()).data as PaymentCreated
}
for (const viewport of [{ label: 'Desktop', width: 1440, height: 960, suffix: '1' }, { label: 'Mobile', width: 390, height: 844, suffix: '2' }]) {
  test(`${viewport.label}: actual Cash/UPI/Card partial payments, final settlement, individual history, unchanged purchase and customer credit`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await signIn(page)
    const { customer, purchase } = await fixture(page, `${viewport.label} Payments`, `912456801${viewport.suffix}`)
    const settled = await addPurchase(page, customer.uuid, '2000.00')
    const partial = await addPurchase(page, customer.uuid, '1500.00')
    await apiPayment(page, customer.uuid, settled.uuid, '2000.00')
    await apiPayment(page, customer.uuid, partial.uuid, '500.00')
    await page.goto(`/customers/${customer.uuid}`)
    await expect(page.getByRole('heading', { name: `${viewport.label} Payments`, exact: true })).toBeVisible()
    await expect(page.getByTestId('customer-outstanding')).toHaveText('₹6000.00')
    await page.getByRole('tab',{ name: 'Sales',exact: true }).click()
    const purchaseHistory = page.getByRole('list', { name: 'Purchase history', exact: true })
    for (const status of ['Unpaid', 'Partially paid', 'Paid']) await expect(purchaseHistory.getByText(status, { exact: true })).toBeVisible()
    await purchaseHistory.locator(`a[href="/customers/${customer.uuid}/purchases/${purchase.uuid}"]`).click()
    await expect(page.getByTestId('purchase-amount-paid')).toHaveText('₹0.00')
    await expect(page.getByTestId('purchase-outstanding')).toHaveText('₹5000.00')
    await expect(page.getByRole('heading', { name: 'No payments yet', exact: true })).toBeVisible()
    const path = api(customer.uuid, purchase.uuid)
    let writes = 0
    page.on('request', request => { if (new URL(request.url()).pathname === path && request.method() === 'POST') writes++ })
    for (const [amount, method, paid, outstanding, credit] of [
      ['2000.00', 'cash', '₹2000.00', '₹3000.00', '₹4000.00'], ['1000.00', 'upi', '₹3000.00', '₹2000.00', '₹3000.00'], ['2000.00', 'card', '₹5000.00', '₹0.00', '₹1000.00'],
    ] as const) {
      await page.getByRole('link', { name: 'Record Payment', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Record Payment', exact: true })).toBeVisible()
      await expect(page.getByLabel('Payment amount (₹)', { exact: true })).toHaveValue(method === 'cash' ? '5000.00' : method === 'upi' ? '3000.00' : '2000.00')
      await page.getByLabel('Payment amount (₹)', { exact: true }).fill(amount)
      await page.getByLabel('Payment method', { exact: true }).selectOption(method)
      await page.getByLabel('Transaction / reference ID', { exact: true }).fill(method === 'cash' ? '' : `REF-${method}`)
      await page.getByLabel('Payment note', { exact: true }).fill(`Recorded ${method} payment`)
      await layout(page)
      if (method === 'cash') await page.screenshot({ path: `test-results/phase-five-${viewport.label.toLowerCase()}-form.png`, fullPage: true })
      const created = await save(page, path, method === 'cash')
      expect(created.purchase_summary.total_paise).toBe(500000)
      await expect(page.getByRole('heading', { name: 'Sale details', exact: true })).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'Payment recorded.' })).toBeVisible()
      await expect(page.getByTestId('purchase-amount-paid')).toHaveText(paid)
      await expect(page.getByTestId('purchase-outstanding')).toHaveText(outstanding)
      await expect(page.getByTestId('purchase-grand-total')).toHaveText('₹5000.00')
      await expect(page.getByRole('list', { name: 'Payment history', exact: true }).getByText(`Recorded ${method} payment`, { exact: true })).toBeVisible()
      await page.getByRole('link', { name: 'Back to customer', exact: true }).click()
      await expect(page.getByTestId('customer-outstanding')).toHaveText(credit)
      await page.getByRole('list', { name: 'Purchase history', exact: true }).locator(`a[href="/customers/${customer.uuid}/purchases/${purchase.uuid}"]`).click()
    }
    expect(writes).toBe(3)
    await expect(page.getByRole('heading', { name: 'Sale details', exact: true })).toBeVisible()
    await expect(page.getByText('Paid', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Record Payment', exact: true })).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Payment history', exact: true }).getByRole('listitem')).toHaveCount(3)
    for (const method of ['Cash', 'UPI', 'Card']) await expect(page.getByRole('list', { name: 'Payment history', exact: true }).getByText(method, { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('purchase-outstanding')).toHaveText('₹0.00')
    await expect(page.getByRole('link', { name: 'Record Payment', exact: true })).toHaveCount(0)
    await layout(page)
    await page.screenshot({ path: `test-results/phase-five-${viewport.label.toLowerCase()}-details.png`, fullPage: true })
    const actual = await page.request.get(`/api/customers/${customer.uuid}/purchases/${purchase.uuid}`)
    const current = (await actual.json()).data as PurchaseDetail
    for (const key of ['total_paise', 'subtotal_paise', 'discount_paise', 'created_at', 'updated_at', 'items'] as const) expect(current[key]).toEqual(purchase[key])
    await page.goto(`/customers/${customer.uuid}/purchases/${purchase.uuid}/payments/new`)
    await expect(page.getByRole('heading', { name: 'Payment cannot be recorded', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  })

  test(`${viewport.label}: payment validation and unsaved cancel/navigation/back/reload, stale-balance error retains input and refreshes server balance`, async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page)
    const { customer, purchase } = await fixture(page, `${viewport.label} Payment guards`, `922456801${viewport.suffix}`, '1000.00')
    const path = api(customer.uuid, purchase.uuid)
    let writes = 0
    page.on('request', request => { if (new URL(request.url()).pathname === path && request.method() === 'POST') writes++ })
    await page.goto(`/customers/${customer.uuid}/purchases/${purchase.uuid}`)
    await page.getByRole('link', { name: 'Record Payment', exact: true }).click()
    for (const amount of ['0', '-1', '1.001', '1000.01']) {
      await page.getByLabel('Payment amount (₹)', { exact: true }).fill(amount)
      await page.getByRole('button', { name: 'Save payment', exact: true }).click()
      await expect(page.getByLabel('Payment amount (₹)', { exact: true })).toHaveAttribute('aria-invalid', 'true')
    }
    expect(writes).toBe(0)
    await page.getByLabel('Payment amount (₹)', { exact: true }).fill('800.00')
    await page.getByLabel('Payment note', { exact: true }).fill('Retained draft note')
    const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true })
    for (const action of ['cancel', 'internal', 'back']) {
      if (action === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      if (action === 'internal') await page.getByRole('link', { name: 'Back to purchase', exact: true }).click()
      if (action === 'back') await page.goBack()
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused()
      await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click()
      await expect(page.getByLabel('Payment note', { exact: true })).toHaveValue('Retained draft note')
    }
    const prompt = page.waitForEvent('dialog')
    await page.evaluate(() => { setTimeout(() => window.location.reload(), 0) })
    const unload = await prompt; expect(unload.type()).toBe('beforeunload'); await unload.dismiss()
    // A real independent payment makes this form's initially displayed balance stale.
    await apiPayment(page, customer.uuid, purchase.uuid, '300.00')
    const rejected = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Save payment', exact: true }).click()
    const response = await rejected; expect(response.status()).toBe(409)
    expect((await response.json()).error.code).toBe('PAYMENT_EXCEEDS_OUTSTANDING')
    await expect(page.getByLabel('Payment amount (₹)', { exact: true })).toBeFocused()
    await expect(page.getByLabel('Payment amount (₹)', { exact: true })).toHaveValue('800.00')
    await expect(page.getByLabel('Payment note', { exact: true })).toHaveValue('Retained draft note')
    await expect(page.getByTestId('purchase-outstanding')).toHaveText('₹700.00')
    await page.getByLabel('Payment amount (₹)', { exact: true }).fill('400.00')
    await save(page, path)
    await expect(page.getByTestId('purchase-outstanding')).toHaveText('₹300.00')
    await expect(page.getByRole('list', { name: 'Payment history', exact: true }).getByRole('listitem')).toHaveCount(2)
    await layout(page)
    expect(writes).toBe(2)
  })

  test(`${viewport.label}: lost-response full-payment retry returns duplicate and never records another payment`, async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page)
    const { customer, purchase } = await fixture(page, `${viewport.label} Lost payment response`, `932456801${viewport.suffix}`, '100.50')
    const path = api(customer.uuid, purchase.uuid)
    await page.goto(`/customers/${customer.uuid}/purchases/${purchase.uuid}`)
    await page.getByRole('link', { name: 'Record Payment', exact: true }).click()
    await page.getByLabel('Transaction / reference ID', { exact: true }).fill('Lost-response reference')
    await page.route(`**${path}`, async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return }
      const committed = await route.fetch(); expect(committed.status()).toBe(201)
      await route.abort('failed'); await page.unroute(`**${path}`)
    })
    await page.getByRole('button', { name: 'Save payment', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save payment', exact: true })).toBeEnabled()
    const repeated = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Save payment', exact: true }).click()
    const response = await repeated; expect(response.status()).toBe(409)
    expect((await response.json()).error.code).toBe('PAYMENT_DUPLICATE')
    await expect(page.getByRole('button', { name: 'Save payment', exact: true })).toBeDisabled()
    await page.getByRole('link', { name: 'View payment history', exact: true }).click()
    await expect(page.getByTestId('purchase-amount-paid')).toHaveText('₹100.50')
    await expect(page.getByTestId('purchase-outstanding')).toHaveText('₹0.00')
    await expect(page.getByRole('list', { name: 'Payment history', exact: true }).getByRole('listitem')).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Record Payment', exact: true })).toHaveCount(0)
    const history = await page.request.get(path)
    expect((await history.json()).data.purchase_summary.payment_status).toBe('paid')
    await layout(page)
  })

  test(`${viewport.label}: paginated chronological history beyond twenty and archived read-only purchase/credit`, async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page)
    const { customer, purchase } = await fixture(page, `${viewport.label} Payment history`, `942456801${viewport.suffix}`, '100.00')
    const path = api(customer.uuid, purchase.uuid), headers = await mutationHeaders(page)
    for (let day = 1; day <= 22; day++) {
      const response = await page.request.post(path, { headers, data: { client_request_id: crypto.randomUUID(), amount: '1.00', payment_method: day % 2 ? 'upi' : 'card', received_at: `2026-05-${String(day).padStart(2, '0')}T12:00:00.000Z`, reference: `REF-${day}` } })
      expect(response.status()).toBe(201)
    }
    const all = (await (await page.request.get(`${path}?pageSize=50`)).json()).data as PaymentList
    await page.goto(`/customers/${customer.uuid}/purchases/${purchase.uuid}`)
    const history = page.getByRole('list', { name: 'Payment history', exact: true }), pagination = page.getByRole('navigation', { name: 'Payment history pagination', exact: true })
    await expect(history.getByRole('listitem')).toHaveCount(20)
    await pagination.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(history.getByRole('listitem')).toHaveCount(2)
    await expect(history.getByText('Reference: REF-21', { exact: true })).toBeVisible()
    await pagination.getByLabel('Per page').selectOption('50')
    await expect(history.getByRole('listitem')).toHaveCount(22)
    expect(await history.locator('time').evaluateAll(elements => elements.map(element => element.getAttribute('datetime')))).toEqual(all.payments.map(row => row.received_at))
    await page.getByRole('link', { name: 'Back to customer', exact: true }).click()
    await expect(page.getByTestId('customer-outstanding')).toHaveText('₹78.00')
    expect((await page.request.delete(`/api/customers/${customer.uuid}`, { headers })).status()).toBe(200)
    await page.reload()
    await expect(page.getByTestId('customer-outstanding')).toHaveText('₹78.00')
    await page.goto(`/customers/${customer.uuid}/purchases/${purchase.uuid}`)
    await expect(page.getByRole('link', { name: 'Record Payment', exact: true })).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Payment history', exact: true }).getByRole('listitem')).toHaveCount(20)
    await layout(page)
    await page.screenshot({ path: `test-results/phase-five-${viewport.label.toLowerCase()}-history.png`, fullPage: true })
  })
}
