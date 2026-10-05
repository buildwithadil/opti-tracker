import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Customer } from '../shared/customers'
import type { Prescription } from '../shared/prescriptions'
import type { PurchaseDetail } from '../shared/purchases'
import type { PaymentCreated, PaymentList } from '../shared/payments'
import type { Invoice } from '../shared/invoices'
import type { ReportResult } from '../shared/reports'
import { browserTestOwner, mutationHeaders, signIn } from './session'
import { rehearseBackup } from './backup-rehearsal'

test('final isolated owner → clinical → purchase → two payments → invoice/print → reports/CSV → full SQL recovery',async ({ page }) => {
  test.setTimeout(180000)
  const errors: string[] = []; page.on('pageerror',error => errors.push(error.message))
  page.on('console',message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('response',response => {
    if (['script','stylesheet'].includes(response.request().resourceType()) && response.status() >= 400) errors.push(`Missing build asset: ${new URL(response.url()).pathname}`)
  })
  await page.setViewportSize({ width: 1440,height: 960 })
  await signIn(page)
  await page.context().clearCookies() // Preserve the earlier session; exercise a fresh real login.
  await signIn(page,{ fresh: true })
  for (const viewport of [{ width: 1440,height: 960 },{ width: 390,height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const route of ['dashboard','customers','purchases','prescriptions','payments','reports','settings']) {
      await page.goto('/'+route)
      await expect(page.locator('main h1')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    await page.goto('/unknown-final-check-route')
    await expect(page).toHaveURL(/\/dashboard$/u)
    await expect(page.getByRole('heading',{ name: 'Dashboard',exact: true })).toBeVisible()
  }
  await page.setViewportSize({ width: 1440,height: 960 })
  await page.goto('/settings')
  await page.getByLabel('Shop name',{ exact: true }).fill('OptiDesk Recovery Fixture Shop')
  await page.getByLabel('Shop address',{ exact: true }).fill('42 Fixture Road\nPune 411001')
  await page.getByLabel('Shop contact number',{ exact: true }).fill('+91 20 2345 6789')
  await page.getByLabel('GSTIN',{ exact: true }).fill('27ABCDE1234F1Z5')
  await page.getByRole('button',{ name: 'Save invoice business information',exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Invoice business information saved.' })).toBeVisible()
  await page.goto('/customers/new')
  await page.getByLabel('Full name',{ exact: true }).fill('Final isolated workflow customer')
  await page.getByLabel('Mobile number',{ exact: true }).fill('9823456701')
  const customerResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/customers' && response.request().method() === 'POST')
  await page.getByRole('button',{ name: 'Save customer',exact: true }).click()
  const customer = (await (await customerResponse).json()).data as Customer
  await expect(page.getByRole('heading',{ name: customer.name,exact: true })).toBeVisible()
  await page.getByRole('link',{ name: 'Add prescription',exact: true }).click()
  await page.getByLabel('Prescription date',{ exact: true }).fill('2020-01-17')
  await page.getByLabel('Right SPH (D)',{ exact: true }).fill('-1.25')
  await page.getByLabel('Left SPH (D)',{ exact: true }).fill('-2.00')
  await page.getByLabel('Distance PD (mm)',{ exact: true }).fill('63.50')
  await page.getByLabel('Prescription notes',{ exact: true }).fill("Original clinician's note; exact\nSecond line")
  const prescriptionResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/customers/${customer.uuid}/prescriptions` && response.request().method() === 'POST')
  await page.getByRole('button',{ name: 'Save prescription',exact: true }).click()
  const prescription = (await (await prescriptionResponse).json()).data as Prescription
  await page.goto(`/customers/${customer.uuid}/purchases/new`)
  await page.getByLabel('Purchase date',{ exact: true }).fill('2020-01-17')
  await page.getByLabel('Link prescription (optional)',{ exact: true }).selectOption(prescription.uuid)
  const item = page.getByRole('group',{ name: 'Item 1',exact: true })
  await item.getByLabel('Product name / description',{ exact: true }).fill('Final original frame snapshot')
  await item.getByLabel('Product category',{ exact: true }).selectOption('spectacle_frames')
  await item.getByLabel('Quantity',{ exact: true }).fill('2')
  await item.getByLabel('Unit price (₹)',{ exact: true }).fill('125.50')
  await item.getByLabel('Line discount (₹)',{ exact: true }).fill('0.50')
  await page.getByLabel('Purchase discount (₹)',{ exact: true }).fill('1.00')
  await expect(page.getByTestId('purchase-total-preview')).toHaveText('₹249.50')
  const purchasePath = `/api/customers/${customer.uuid}/purchases`
  const purchaseResponse = page.waitForResponse(response => new URL(response.url()).pathname === purchasePath && response.request().method() === 'POST')
  await page.getByRole('button',{ name: 'Save purchase',exact: true }).click()
  const purchase = (await (await purchaseResponse).json()).data as PurchaseDetail
  expect(purchase.total_paise).toBe(24950)
  const path = `${purchasePath}/${purchase.uuid}`, route = `/customers/${customer.uuid}/purchases/${purchase.uuid}`
  for (const [amount,method,paid,outstanding] of [['100.00','cash','₹100.00','₹149.50'],['149.50','upi','₹249.50','₹0.00']]) {
    await page.getByRole('link',{ name: 'Record Payment',exact: true }).click()
    await page.getByLabel('Payment amount (₹)',{ exact: true }).fill(amount)
    await page.getByLabel('Payment method',{ exact: true }).selectOption(method)
    const response = page.waitForResponse(response => new URL(response.url()).pathname === `${path}/payments` && response.request().method() === 'POST')
    await page.getByRole('button',{ name: 'Save payment',exact: true }).click()
    expect((await (await response).json()).data as PaymentCreated).toMatchObject({ purchase_summary: { total_paise: 24950 } })
    await expect(page.getByTestId('purchase-amount-paid')).toHaveText(paid)
    await expect(page.getByTestId('purchase-outstanding')).toHaveText(outstanding)
    await expect(page.getByTestId('purchase-grand-total')).toHaveText('₹249.50')
  }
  const payments = (await (await page.request.get(`${path}/payments`)).json()).data as PaymentList
  expect(payments.payments).toHaveLength(2)
  await page.getByRole('link',{ name: 'View invoice',exact: true }).click()
  const invoiceResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${path}/invoice` && response.request().method() === 'POST')
  await page.getByRole('button',{ name: 'Generate invoice',exact: true }).click()
  const invoice = (await (await invoiceResponse).json()).data as Invoice
  await expect(page.getByTestId('invoice-balance')).toHaveText('₹0.00')
  await expect(page.getByTestId('invoice-total')).toHaveText('₹249.50')
  expect(invoice.snapshot.purchase.prescription_uuid).toBe(prescription.uuid)
  const reused = await page.request.post(`${path}/invoice`,{ headers: await mutationHeaders(page),data: { client_request_id: crypto.randomUUID() } })
  expect(reused.status()).toBe(200); expect((await reused.json()).data).toEqual(invoice)
  await page.evaluate(() => window.addEventListener('beforeprint',() => { document.documentElement.dataset.phaseEightPrint = 'yes' },{ once: true }))
  await page.getByRole('button',{ name: 'Print invoice',exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.phaseEightPrint)).toBe('yes')
  const pdf = test.info().outputPath('final-workflow-a4.pdf')
  await page.pdf({ path: pdf,preferCSSPageSize: true,displayHeaderFooter: false })
  expect(execFileSync('pdfinfo',[pdf],{ encoding: 'utf8' })).toMatch(/Page size:.*\(A4\)/u)
  const print = execFileSync('pdftotext',['-layout',pdf,'-'],{ encoding: 'utf8' })
  expect(print).toContain('249.50'); expect(print).toContain('0.00')
  for (const excluded of ['Sign out','Print invoice','Back to purchase']) expect(print).not.toContain(excluded)
  const dates = 'dateFrom=2020-01-17&dateTo=2020-01-17'
  await page.goto(`/reports?report=sales&${dates}`)
  await expect(page.getByTestId('report-total_paise')).toHaveText('₹249.50')
  await expect(page.getByTestId('report-amount_paid_paise')).toHaveText('₹249.50')
  await expect(page.getByTestId('report-outstanding_paise')).toHaveText('₹0.00')
  const download = page.waitForEvent('download')
  await page.getByRole('button',{ name: 'Download CSV',exact: true }).click()
  const csvPath = test.info().outputPath('final-workflow-sales.csv'); await (await download).saveAs(csvPath)
  expect(readFileSync(csvPath,'utf8')).toContain(',249.50,249.50,0.00,paid')
  const outstanding = (await (await page.request.get('/api/reports/outstanding')).json()).data as ReportResult
  expect(outstanding.rows.some(row => row.customer_uuid === customer.uuid)).toBe(false)
  expect((await (await page.request.get(`/api/customers/${customer.uuid}`)).json()).data).toEqual(customer)
  expect((await (await page.request.get(`/api/customers/${customer.uuid}/prescriptions/${prescription.uuid}`)).json()).data).toEqual(prescription)
  const current = (await (await page.request.get(path)).json()).data as PurchaseDetail
  for (const field of ['items','total_paise','subtotal_paise','discount_paise','created_at','updated_at','prescription_uuid'] as const) expect(current[field]).toEqual(purchase[field])
  expect((await (await page.request.get(`${path}/payments`)).json()).data).toEqual(payments)
  await page.goto(`${route}/invoice`)
  await page.setViewportSize({ width: 390,height: 844 })
  await expect(page.getByTestId('invoice-number')).toHaveText(invoice.invoice_number)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => localStorage.length+sessionStorage.length)).toBe(0)
  const cookies = await page.context().cookies()
  const cookie = cookies.find(value => value.name === 'optidesk_session')!
  expect(cookie.httpOnly).toBe(true)
  const recovered = await rehearseBackup({ outputDirectory: test.info().outputDir,owner: browserTestOwner,invoice,sourceCookie: `${cookie.name}=${cookie.value}` })
  expect(recovered.sourceUnchanged).toBe(true)
  expect(recovered.newInvoiceNumberUnique).toBe(true)
  expect(errors).toEqual([])
})
