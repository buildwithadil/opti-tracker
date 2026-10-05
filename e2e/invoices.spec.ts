import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import type { Invoice } from '../shared/invoices'
import type { PurchaseDetail } from '../shared/purchases'
import { mutationHeaders, signIn } from './session'

async function configure(page: Page, throughUi = false) {
  if (throughUi) {
    await page.goto('/settings')
    await page.getByLabel('Shop name', { exact: true }).fill('OptiDesk Print Test Shop')
    await page.getByLabel('Shop address', { exact: true }).fill('42 Market Road\nPune 411001')
    await page.getByLabel('Shop contact number', { exact: true }).fill('+91 20 2345 6789')
    await page.getByLabel('GSTIN', { exact: true }).fill('27ABCDE1234F1Z5')
    await page.getByRole('button', { name: 'Save invoice business information', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Invoice business information saved.' })).toBeVisible()
  } else {
    const current = await page.request.get('/api/shop/invoice-identity')
    expect(current.status()).toBe(200)
    const response = await page.request.patch('/api/shop/invoice-identity', { headers: await mutationHeaders(page), data: { ...(await current.json()).data, shop_name: 'OptiDesk Print Test Shop', address: '42 Market Road\nPune 411001', contact_number: '+91 20 2345 6789', gstin: '27ABCDE1234F1Z5' } })
    expect(response.status()).toBe(200)
  }
}
async function fixture(page: Page, name: string, phone: string, long = false) {
  const headers = await mutationHeaders(page)
  const created = await page.request.post('/api/customers', { headers, data: { name, phone } })
  expect(created.status()).toBe(201)
  const customer = (await created.json()).data as { uuid: string; name: string; phone: string }
  const items = long ? Array.from({ length: 100 }, (_, index) => ({ description: `Line ${String(index + 1).padStart(3, '0')} original optical item, preserved prices`, product_category: 'other', quantity: 1, unit_price: '1.00', discount: '0.01' })) : [
    { description: 'Original Acetate Frame', product_category: 'spectacle_frames', quantity: 2, unit_price: '125.50', discount: '0.50' },
    { description: 'Original Prescription Lenses', product_category: 'prescription_lenses', quantity: 3, unit_price: '250.00', discount: '0.01' },
  ]
  const response = await page.request.post(`/api/customers/${customer.uuid}/purchases`, { headers, data: { client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', order_discount: long ? '0' : '1.00', items } })
  expect(response.status()).toBe(201)
  const purchase = (await response.json()).data as PurchaseDetail
  const api = `/api/customers/${customer.uuid}/purchases/${purchase.uuid}/invoice`
  const route = `/customers/${customer.uuid}/purchases/${purchase.uuid}`
  return { customer, purchase, api, route }
}
async function payment(page: Page, customer: string, purchase: string, amount: string, method: string) {
  const response = await page.request.post(`/api/customers/${customer}/purchases/${purchase}/payments`, { headers: await mutationHeaders(page), data: { client_request_id: crypto.randomUUID(), amount, payment_method: method } })
  expect(response.status()).toBe(201)
}
async function generate(page: Page, api: string, double = false) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === api && response.request().method() === 'POST')
  const button = page.getByRole('button', { name: 'Generate invoice', exact: true })
  if (double) await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click() })
  else await button.click()
  const response = await pending
  expect(response.status()).toBe(201)
  const invoice = (await response.json()).data as Invoice
  await expect(page.getByRole('heading', { name: 'View invoice', exact: true })).toBeVisible()
  await expect(page.getByTestId('invoice-number')).toHaveText(invoice.invoice_number)
  return invoice
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
}
async function printPdf(page: Page, label: string, manyPages: boolean) {
  // Invoke the native print function; don't replace it with a mock. Headless
  // Chromium emits beforeprint. PDF uses the same engine's print-to-PDF path.
  await page.evaluate(() => window.addEventListener('beforeprint', () => { document.documentElement.dataset.nativePrint = 'yes' }, { once: true }))
  await page.getByRole('button', { name: 'Print invoice', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.nativePrint)).toBe('yes')
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('navigation', { name: 'Primary navigation', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Print invoice', exact: true })).not.toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to purchase', exact: true })).not.toBeVisible()
  await expect(page.getByTestId('invoice-total')).toBeVisible()
  await expect(page.getByTestId('invoice-balance')).toBeVisible()
  const path = test.info().outputPath(`${label}.pdf`)
  await page.pdf({ path, preferCSSPageSize: true, printBackground: false, displayHeaderFooter: false })
  // Poppler is installed in this environment; inspect real PDF text/coordinates,
  // not just a print-media screenshot or a count of DOM rows.
  const info = execFileSync('pdfinfo', [path], { encoding: 'utf8' })
  const pages = Number(info.match(/Pages:\s+(\d+)/u)?.[1])
  expect(pages).toBeGreaterThanOrEqual(manyPages ? 3 : 1)
  if (!manyPages) expect(pages).toBe(1)
  expect(info).toMatch(/Page size:\s+59[45](?:\.\d+)? x 84[12](?:\.\d+)? pts \(A4\)/u)
  const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' })
  for (const excluded of ['Workspace readiness', 'Sign out', 'Back to purchase', 'Print invoice', 'Primary navigation', 'Administrator workspace']) expect(text).not.toContain(excluded)
  for (const required of ['OptiDesk Print Test Shop', 'Purchase total', 'Total paid at issue', 'Balance due', 'Payment position at issue']) expect(text.toLowerCase()).toContain(required.toLowerCase())
  const bbox = execFileSync('pdftotext', ['-bbox', path, '-'], { encoding: 'utf8' })
  const pageBlocks = [...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/gu)]
  expect(pageBlocks).toHaveLength(pages)
  for (const [index, block] of pageBlocks.entries()) {
    const width = Number(block[1]), height = Number(block[2])
    const words = [...block[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">/gu)]
    expect(words.length).toBeGreaterThan(0)
    // PDF font bounding boxes can include unused ascender space. Check those
    // against the physical page; check the actual rendered ink against margins.
    for (const word of words) { expect(Number(word[1])).toBeGreaterThanOrEqual(0); expect(Number(word[2])).toBeGreaterThanOrEqual(0); expect(Number(word[3])).toBeLessThanOrEqual(width); expect(Number(word[4])).toBeLessThanOrEqual(height) }
    const image = execFileSync('pdftoppm', ['-f', String(index + 1), '-l', String(index + 1), '-singlefile', '-r', '72', '-gray', path])
    const header = image.subarray(0, 64).toString('ascii').match(/^P5\s+(\d+)\s+(\d+)\s+255\s/u)
    expect(header).not.toBeNull()
    const pixels = image.subarray(header![0].length), pixelWidth = Number(header![1]), pixelHeight = Number(header![2])
    expect(pixels.length).toBe(pixelWidth * pixelHeight)
    let minX = pixelWidth, minY = pixelHeight, maxX = 0, maxY = 0
    for (let y = 0; y < pixelHeight; y++) for (let x = 0; x < pixelWidth; x++) if (pixels[y * pixelWidth + x] < 240) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
    expect(minX).toBeGreaterThanOrEqual(38); expect(minY).toBeGreaterThanOrEqual(38)
    expect(maxX).toBeLessThanOrEqual(pixelWidth - 38); expect(maxY).toBeLessThanOrEqual(pixelHeight - 38)
  }
  if (manyPages) {
    for (let index = 1; index <= 100; index++) expect(text).toMatch(new RegExp(`Line\\s+${String(index).padStart(3, '0')}`, 'u'))
    const itemPages = text.split('\f').filter(part => /Line\s+\d{3}/u.test(part))
    expect(itemPages.length).toBeGreaterThanOrEqual(3)
    for (const part of itemPages) for (const header of ['Item', 'Qty', 'Unit price', 'Discount', 'Line total']) expect(part).toContain(header)
    expect(text.split('\f').filter(part => part.trim()).at(-1)).toContain('Purchase total')
  }
  await page.emulateMedia({ media: 'screen' })
}

for (const viewport of [{ label: 'Desktop', width: 1440, height: 960, suffix: '1' }, { label: 'Mobile', width: 390, height: 844, suffix: '2' }]) {
  test(`${viewport.label}: invoice business configuration, partial multiple-method invoice, double click, real A4 print and immutable reprint`, async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page); await configure(page, true)
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    const { customer, purchase, api, route } = await fixture(page, `${viewport.label} Invoice customer`, `952456801${viewport.suffix}`)
    await payment(page, customer.uuid, purchase.uuid, '100.00', 'cash')
    await payment(page, customer.uuid, purchase.uuid, '200.00', 'upi')
    await payment(page, customer.uuid, purchase.uuid, '50.00', 'card')
    await page.goto(route)
    await page.getByRole('link', { name: 'View invoice', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Generate invoice', exact: true })).toBeVisible()
    let writes = 0; page.on('request', request => { if (new URL(request.url()).pathname === api && request.method() === 'POST') writes++ })
    const invoice = await generate(page, api, true)
    expect(writes).toBe(1)
    const document = page.getByRole('article', { name: `Invoice ${invoice.invoice_number}`, exact: true })
    await expect(document.getByText(customer.name, { exact: true })).toBeVisible()
    await expect(document.getByText(customer.phone, { exact: true })).toBeVisible()
    await expect(page.getByTestId('invoice-total')).toHaveText('₹999.49')
    await expect(page.getByTestId('invoice-paid')).toHaveText('₹350.00')
    await expect(page.getByTestId('invoice-balance')).toHaveText('₹649.49')
    await expect(document.getByText('Partially paid', { exact: true })).toBeVisible()
    for (const method of ['Cash', 'UPI', 'Card']) await expect(document.getByText(method, { exact: true })).toBeVisible()
    await expect(document.getByRole('row')).toHaveCount(3)
    expect((await document.locator('caption').boundingBox())!.height).toBeLessThan(40)
    await noOverflow(page)
    await page.screenshot({ path: test.info().outputPath(`phase-six-${viewport.label.toLowerCase()}-invoice.png`), fullPage: true })
    await printPdf(page, `phase-six-${viewport.label.toLowerCase()}-a4`, false)
    await payment(page, customer.uuid, purchase.uuid, '649.49', 'card')
    expect((await page.request.patch(`/api/customers/${customer.uuid}`, { headers: await mutationHeaders(page), data: { name: 'Changed after issue' } })).status()).toBe(200)
    await page.reload()
    await expect(page.getByTestId('invoice-balance')).toHaveText('₹649.49')
    await expect(page.getByTestId('invoice-number')).toHaveText(invoice.invoice_number)
    await expect(document.getByText(customer.name, { exact: true })).toBeVisible()
    const original = (await (await page.request.get(api)).json()).data as Invoice
    expect(original).toEqual(invoice)
    const source = (await (await page.request.get(`/api/customers/${customer.uuid}/purchases/${purchase.uuid}`)).json()).data as PurchaseDetail
    for (const field of ['items', 'total_paise', 'subtotal_paise', 'discount_paise', 'created_at', 'updated_at'] as const) expect(source[field]).toEqual(purchase[field])
    expect(errors).toEqual([])
  })
  test(`${viewport.label}: real committed invoice with lost response retries the same paid invoice and number`, async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page); await configure(page)
    const { customer, purchase, api, route } = await fixture(page, `${viewport.label} Paid invoice`, `962456801${viewport.suffix}`)
    await payment(page, customer.uuid, purchase.uuid, '999.49', 'card')
    await page.goto(`${route}/invoice`)
    let issued!: Invoice
    await page.route(`**${api}`, async route => { if (route.request().method() !== 'POST') { await route.continue(); return }; const committed = await route.fetch(); expect(committed.status()).toBe(201); issued = (await committed.json()).data as Invoice; await route.abort('failed'); await page.unroute(`**${api}`) })
    await page.getByRole('button', { name: 'Generate invoice', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    const repeated = page.waitForResponse(response => new URL(response.url()).pathname === api && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Generate invoice', exact: true }).click()
    expect((await repeated).status()).toBe(200)
    await expect(page.getByTestId('invoice-number')).toHaveText(issued.invoice_number)
    await expect(page.getByTestId('invoice-balance')).toHaveText('₹0.00')
    await expect(page.getByRole('article').getByText('Paid', { exact: true })).toBeVisible()
    await printPdf(page, `phase-six-${viewport.label.toLowerCase()}-paid-a4`, false)
    await noOverflow(page)
  })
  test(`${viewport.label}: one hundred unpaid historical lines render as unclipped multi-page A4 with repeated headers and visible final totals`, async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page); await configure(page)
    const { api, route } = await fixture(page, `${viewport.label} Long invoice`, `972456801${viewport.suffix}`, true)
    await page.goto(`${route}/invoice`)
    await generate(page, api)
    await expect(page.getByRole('article').getByRole('row')).toHaveCount(101)
    await expect(page.getByTestId('invoice-total')).toHaveText('₹99.00')
    await expect(page.getByTestId('invoice-paid')).toHaveText('₹0.00')
    await expect(page.getByRole('article').getByText('Unpaid', { exact: true })).toBeVisible()
    await noOverflow(page)
    await printPdf(page, `phase-six-${viewport.label.toLowerCase()}-long-a4`, true)
  })
}
