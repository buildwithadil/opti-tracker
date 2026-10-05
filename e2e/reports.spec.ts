import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import type { DashboardResult, ReportResult } from '../shared/reports'
import { reportBusinessDate } from '../shared/reportDates'
import { mutationHeaders, signIn } from './session'

async function data<T>(page: Page,path: string): Promise<T> {
  const response = await page.request.get(path); expect(response.status()).toBe(200)
  return (await response.json()).data as T
}
async function createCustomer(page: Page,name: string,phone: string) {
  const response = await page.request.post('/api/customers',{ headers: await mutationHeaders(page),data: { name,phone } })
  expect(response.status()).toBe(201); return (await response.json()).data as { uuid: string }
}
async function createSale(page: Page,customer: string,date: string,amount: string,accessory = false) {
  const response = await page.request.post(`/api/customers/${customer}/purchases`,{ headers: await mutationHeaders(page),data: {
    client_request_id: crypto.randomUUID(),purchase_date: date,items: [{ description: 'Private browser product',product_category: accessory ? 'optical_accessories' : 'spectacle_frames',quantity: accessory ? 2 : 1,unit_price: amount,discount: accessory ? '0.01' : '0' }],notes: 'Private browser purchase note',
  } })
  expect(response.status()).toBe(201); return (await response.json()).data as { uuid: string }
}
async function pay(page: Page,customer: string,purchase: string,amount: string,method = 'cash',receivedAt?: string) {
  const response = await page.request.post(`/api/customers/${customer}/purchases/${purchase}/payments`,{ headers: await mutationHeaders(page),data: { client_request_id: crypto.randomUUID(),amount,payment_method: method,...(receivedAt ? { received_at: receivedAt } : {}),reference: 'Private browser reference' } })
  expect(response.status()).toBe(201)
}
async function download(page: Page,label: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button',{ name: 'Download CSV',exact: true }).click()
  const file = await pending
  expect(file.suggestedFilename()).toMatch(/^optidesk-[a-z]+-.+\.csv$/u)
  const path = test.info().outputPath(`${label}.csv`)
  await file.saveAs(path)
  return readFileSync(path,'utf8')
}
async function layout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.evaluate(() => localStorage.length+sessionStorage.length)).toBe(0)
}
for (const viewport of [{ label: 'Desktop',width: 1440,height: 960,suffix: '1',date: '2026-02-11' },{ label: 'Mobile',width: 390,height: 844,suffix: '2',date: '2026-02-12' }]) {
  test(`${viewport.label}: actual sales, payments, credit, customer/category reports and all four authenticated CSV downloads`,async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page)
    const errors: string[] = []; page.on('pageerror',error => errors.push(error.message))
    const customer = await createCustomer(page,`=${viewport.label} Report "देवी", desk`,`923451230${viewport.suffix}`)
    const first = await createSale(page,customer.uuid,viewport.date,'100.01')
    for (let i = 0; i < 10; i++) await createSale(page,customer.uuid,viewport.date,'0.51',true)
    await pay(page,customer.uuid,first.uuid,'5','upi',`${viewport.date}T12:00:00.000Z`)
    const archive = await page.request.delete(`/api/customers/${customer.uuid}`,{ headers: await mutationHeaders(page) }); expect(archive.status()).toBe(200)
    const writes: string[] = []; page.on('request',req => { if (new URL(req.url()).pathname.startsWith('/api/') && !['GET','HEAD'].includes(req.method())) writes.push(req.method()) })
    const dates = `dateFrom=${viewport.date}&dateTo=${viewport.date}`
    await page.goto(`/reports?report=sales&${dates}&pageSize=10`)
    await expect(page.getByTestId('report-total_paise')).toHaveText('₹110.11')
    await expect(page.getByTestId('report-subtotal_paise')).toHaveText('₹110.21')
    await expect(page.getByTestId('report-discount_paise')).toHaveText('₹0.10')
    await expect(page.getByTestId('report-outstanding_paise')).toHaveText('₹105.11')
    const rows = viewport.label === 'Desktop' ? page.getByRole('table').locator('tbody tr') : page.getByRole('list',{ name: 'Sales report details',exact: true }).getByRole('listitem')
    await expect(rows).toHaveCount(10)
    await page.getByRole('button',{ name: 'Next',exact: true }).click()
    await expect(page.getByRole('navigation',{ name: 'Report pagination' })).toContainText('Page 2 of 2')
    await expect(rows).toHaveCount(1)
    await expect(page.getByTestId('report-total_paise')).toHaveText('₹110.11')
    const csv = await download(page,'sales')
    expect(csv.trim().split('\r\n')).toHaveLength(12)
    expect(csv).toContain(`"'=${viewport.label} Report ""देवी"", desk"`)
    expect(csv).toContain(',100.01,5.00,95.01,partially_paid')
    expect(csv).not.toMatch(/Private browser|csrf|password|notes|reference/iu)
    await page.screenshot({ path: `test-results/phase-seven-${viewport.label.toLowerCase()}-sales.png`,fullPage: true })
    for (const name of ['payments','categories','outstanding','customers'] as const) {
      await page.getByLabel('Report',{ exact: true }).selectOption(name)
      await expect(page.getByRole('heading',{ name: `${name === 'categories' ? 'Product categories' : name === 'outstanding' ? 'Outstanding credit' : name === 'payments' ? 'Payments' : 'Customers'} summary`,exact: true })).toBeVisible()
      const result = await data<ReportResult>(page,`/api/reports/${name}${name === 'payments' || name === 'categories' ? `?${dates}` : ''}`)
      const key = name === 'payments' ? 'total_paise' : name === 'categories' ? 'sales_paise' : name === 'outstanding' ? 'outstanding_paise' : 'customer_count'
      await expect(page.getByTestId(`report-${key}`)).toHaveText(key.endsWith('_paise') ? `₹${(BigInt(result.summary[key])/100n).toString()}.${String(BigInt(result.summary[key])%100n).padStart(2,'0')}` : String(result.summary[key]))
      if (name !== 'customers') {
        const csv = await download(page,name)
        if (name === 'payments') { expect(csv).toContain('2026-02-'); expect(csv).toContain(',upi,5.00') }
        if (name === 'categories') { expect(csv).toContain('Optical accessories,10,20,10.10'); expect(csv).not.toMatch(/stock|inventory/iu) }
        if (name === 'outstanding') expect(csv).toContain(',Archived,11,105.11')
      } else await expect(page.getByRole('button',{ name: 'Download CSV' })).toHaveCount(0)
      await layout(page)
    }
    expect(writes).toEqual([]); expect(errors).toEqual([])
  })
  test(`${viewport.label}: date presets, custom validation, empty results and genuine loading/error/retry states`,async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/reports/sales?**',async route => { await held; await route.continue() })
    await page.goto('/reports?dateFrom=2020-01-01&dateTo=2020-01-01')
    await expect(page.getByRole('status').filter({ hasText: 'Loading report…' })).toBeVisible()
    release()
    await expect(page.getByRole('heading',{ name: 'No matching records' })).toBeVisible()
    await page.unroute('**/api/reports/sales?**')
    await expect(page.getByTestId('report-total_paise')).toHaveText('₹0.00')
    for (const preset of ['Today','Yesterday','Last 7 days','Last 30 days','This month','Previous month']) {
      await page.getByLabel('Date preset').selectOption(preset)
      await page.getByRole('button',{ name: 'Apply dates' }).click()
      await expect(page.getByRole('heading',{ name: 'Sales summary',exact: true })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
    }
    await page.getByLabel('Start date',{ exact: true }).fill('2026-03-02')
    await page.getByLabel('End date',{ exact: true }).fill('2026-03-01')
    await page.getByRole('button',{ name: 'Apply dates' }).click()
    await expect(page.getByRole('alert')).toContainText('The end date cannot precede the start date.')
    await page.getByLabel('Start date',{ exact: true }).fill('2020-01-01')
    await page.getByLabel('End date',{ exact: true }).fill('2020-01-01')
    await page.route('**/api/reports/sales?**',route => route.abort())
    await page.getByRole('button',{ name: 'Apply dates' }).click()
    await expect(page.getByRole('heading',{ name: 'Report could not be loaded' })).toBeVisible()
    await page.unroute('**/api/reports/sales?**')
    await page.getByRole('button',{ name: 'Try again',exact: true }).click()
    await expect(page.getByRole('heading',{ name: 'No matching records' })).toBeVisible()
    await layout(page)
  })
  test(`${viewport.label}: dashboard shows real today/current totals and refreshes after actual purchase/payments`,async ({ page }) => {
    await page.setViewportSize(viewport); await signIn(page)
    const before = await data<DashboardResult>(page,'/api/reports/dashboard')
    const customer = await createCustomer(page,`${viewport.label} Dashboard`,`934561230${viewport.suffix}`)
    const sale = await createSale(page,customer.uuid,reportBusinessDate(),'50.01')
    await pay(page,customer.uuid,sale.uuid,'10')
    await page.goto('/dashboard')
    await expect(page.getByTestId('dashboard-purchases')).toHaveText(String(before.sales.purchase_count+1))
    await expect(page.getByTestId('dashboard-customers')).toHaveText(String(before.customers.customer_count+1))
    const current = await data<DashboardResult>(page,'/api/reports/dashboard')
    expect(current.sales.total_paise).toBe(before.sales.total_paise+5001)
    expect(current.payments.total_paise).toBe(before.payments.total_paise+1000)
    expect(current.outstanding.outstanding_paise).toBe(before.outstanding.outstanding_paise+4001)
    await pay(page,customer.uuid,sale.uuid,'40.01','card')
    await page.getByRole('button',{ name: 'Refresh overview' }).click()
    const refreshed = await data<DashboardResult>(page,'/api/reports/dashboard')
    await expect(page.getByTestId('dashboard-outstanding')).toHaveText(`₹${BigInt(refreshed.outstanding.outstanding_paise)/100n}.${String(BigInt(refreshed.outstanding.outstanding_paise)%100n).padStart(2,'0')}`)
    expect(refreshed.outstanding.outstanding_paise).toBe(before.outstanding.outstanding_paise)
    await layout(page)
    await page.screenshot({ path: `test-results/phase-seven-${viewport.label.toLowerCase()}-dashboard.png`,fullPage: true })
  })
}
test('report deep links recover out-of-range pages and invalid dates without leaking or persisting data',async ({ page }) => {
  await signIn(page)
  await page.goto('/reports?report=sales&dateFrom=2020-01-01&dateTo=2020-01-01&page=10000')
  await expect(page.getByRole('navigation',{ name: 'Report pagination' })).toContainText('Page 1 of 1')
  await page.goto('/reports?report=payments&dateFrom=2026-02-30&dateTo=2026-03-01')
  await expect(page.getByRole('heading',{ name: 'Check the report dates' })).toBeVisible()
  await layout(page)
})
test('revoked real session blocks CSV and JSON with safe feedback and no download',async ({ page }) => {
  await signIn(page)
  await page.goto('/reports?report=outstanding')
  await expect(page.getByRole('button',{ name: 'Download CSV' })).toBeEnabled()
  const logout = await page.request.post('/api/auth/logout',{ headers: await mutationHeaders(page),data: {} }); expect(logout.status()).toBe(200)
  let downloads = 0; page.on('download',() => { downloads++ })
  await page.getByRole('button',{ name: 'Download CSV' }).click()
  await expect(page.getByRole('alert')).toContainText('Please sign in to continue.')
  expect(downloads).toBe(0)
  const response = await page.request.get('/api/reports/dashboard'); expect(response.status()).toBe(401)
  await page.reload()
  await expect(page.getByRole('heading',{ name: 'Administrator sign in' })).toBeVisible()
  await layout(page)
})
