import { expect, test, type Page } from '@playwright/test'
import type { Customer } from '../shared/customers'
import type { PurchaseDetail } from '../shared/purchases'
import type { Invoice } from '../shared/invoices'
import { mutationHeaders, signIn } from './session'

async function identity(page: Page) {
  const current=(await (await page.request.get('/api/shop/invoice-identity')).json()).data
  const response=await page.request.patch('/api/shop/invoice-identity',{ headers: await mutationHeaders(page),data: { shop_name: 'Mobile Workflow Fixture Shop',address: '42 Test Street\nPune',contact_number: '+91 20 2345 6789',gstin: '',updated_at: current.updated_at } })
  expect(response.status()).toBe(200)
}
async function createCustomer(page: Page,name: string,phone: string) {
  const response=await page.request.post('/api/customers',{ headers: await mutationHeaders(page),data: { name,phone } })
  expect(response.status()).toBe(201)
  return (await response.json()).data as Customer
}
async function items(page: Page,price='100') {
  const item=page.getByRole('group',{ name: 'Item 1',exact: true })
  await item.getByLabel('Product name / description',{ exact: true }).fill('Test frame')
  await item.getByLabel('Unit price (₹)',{ exact: true }).fill(price)
}
async function layout(page: Page) {
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0)
}
const heading=(page: Page,name: string)=>page.getByRole('heading',{ name,exact: true })

test('phone: Rahul inline customer → paired prescription → ₹5000 sale/₹2000 UPI → print → ₹3000 Cash → zero credit/history',async ({ page })=>{
  await page.setViewportSize({ width: 390,height: 844 })
  const errors: string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{ if (message.type()==='error') errors.push(message.text()) })
  page.on('response',response=>{ if (['script','stylesheet'].includes(response.request().resourceType()) && response.status()>=400) errors.push('Missing asset') })
  await signIn(page); await identity(page); await page.goto('/dashboard')
  await page.getByRole('navigation',{ name: 'Mobile primary navigation' }).getByRole('link',{ name: 'New Sale',exact: true }).click()
  await page.getByRole('button',{ name: 'Add customer',exact: true }).click()
  const sheet=page.getByRole('dialog',{ name: 'Add customer',exact: true })
  await expect(sheet.getByLabel('Full name',{ exact: true })).toBeFocused()
  await sheet.getByLabel('Full name',{ exact: true }).fill('Rahul Sharma')
  await sheet.getByLabel('Mobile number',{ exact: true }).fill('9876543210')
  const created=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/customers' && response.request().method()==='POST')
  await sheet.getByRole('button',{ name: 'Save & Continue',exact: true }).click()
  const customer=(await (await created).json()).data as Customer
  await expect(sheet).not.toBeVisible(); await items(page,'2000')
  await page.getByRole('button',{ name: 'Add item',exact: true }).click()
  const lens=page.getByRole('group',{ name: 'Item 2',exact: true })
  await lens.getByLabel('Product name / description',{ exact: true }).fill('Prescription lenses')
  await lens.getByLabel('Product category',{ exact: true }).selectOption('prescription_lenses')
  await lens.getByLabel('Unit price (₹)',{ exact: true }).fill('3000')
  await page.getByRole('button',{ name: 'New prescription',exact: true }).click()
  const rx=page.getByRole('dialog',{ name: 'New prescription',exact: true })
  for (const [label,value] of [['Right SPH (D)','-1.50'],['Right CYL (D)','-0.50'],['Right AXIS (°)','90'],['Left SPH (D)','-1.25'],['Left CYL (D)','-0.25'],['Left AXIS (°)','85']]) await rx.getByLabel(label,{ exact: true }).fill(value)
  await layout(page)
  await rx.getByRole('button',{ name: 'Save prescription & Continue',exact: true }).click()
  await expect(rx).not.toBeVisible(); await expect(page.getByLabel('Select prescription')).not.toHaveValue('')
  await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click()
  await expect(page.getByTestId('sale-total')).toHaveText('₹5000.00')
  await page.getByLabel('Payment amount (₹)',{ exact: true }).fill('2000')
  await page.getByRole('radio',{ name: 'UPI',exact: true }).check()
  await page.getByRole('button',{ name: 'Complete Sale',exact: true }).click()
  await expect(heading(page,'Sale completed')).toBeVisible()
  await expect(page.getByTestId('completed-paid')).toHaveText('₹2000.00')
  await expect(page.getByTestId('completed-due')).toHaveText('₹3000.00')
  const saleList=(await (await page.request.get(`/api/sales?customer_uuid=${customer.uuid}`)).json()).data
  expect(saleList.sales).toHaveLength(1)
  const sale=saleList.sales[0] as PurchaseDetail
  const invoicePath=`/api/customers/${customer.uuid}/purchases/${sale.uuid}/invoice`
  const original=(await (await page.request.get(invoicePath)).json()).data as Invoice
  await page.evaluate(()=>window.addEventListener('beforeprint',()=>{ document.documentElement.dataset.mobilePrint='yes' },{ once: true }))
  await page.getByRole('link',{ name: 'Print Invoice',exact: true }).click()
  await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.mobilePrint)).toBe('yes')
  await expect(page.getByTestId('invoice-balance')).toHaveText('₹3000.00')
  await page.getByRole('navigation',{ name: 'Mobile primary navigation' }).getByRole('link',{ name: 'Home',exact: true }).click()
  await page.getByRole('region',{ name: 'Quick actions' }).getByRole('link',{ name: 'Receive Payment',exact: true }).click()
  await page.getByLabel('Search customer',{ exact: true }).fill('Rahul')
  await page.getByRole('button',{ name: 'Select Rahul Sharma',exact: true }).click()
  await expect(page.getByTestId('collect-outstanding')).toHaveText('₹3000.00 due')
  await expect(page.getByLabel('Payment amount (₹)',{ exact: true })).toHaveValue('3000.00')
  await page.getByRole('button',{ name: 'Receive Payment',exact: true }).click()
  await expect(heading(page,'Payment received')).toBeVisible()
  await expect(page.getByTestId('received-remaining')).toHaveText('₹0.00')
  await page.goto('/customers'); await page.getByLabel('Search customers').fill('9876543210')
  const result=page.getByRole('list',{ name: 'Customer search results' })
  await expect(result.getByRole('link',{ name: 'Rahul Sharma',exact: true })).toBeVisible()
  await expect(result).toContainText('₹0.00')
  await result.getByRole('link',{ name: 'Rahul Sharma',exact: true }).click()
  await expect(page.getByTestId('customer-outstanding')).toHaveText('₹0.00')
  await page.getByRole('tab',{ name: 'Prescriptions',exact: true }).click()
  await expect(page.getByRole('list',{ name: 'Prescription history',exact: true }).getByRole('listitem')).toHaveCount(1)
  await page.getByRole('tab',{ name: 'Payments',exact: true }).click()
  await expect(page.getByRole('list',{ name: 'Customer payment receipts' }).getByRole('listitem')).toHaveCount(2)
  await page.goto('/sales'); await page.getByLabel('Search sales').fill(original.invoice_number)
  await expect(page.getByRole('list',{ name: 'Sales history' })).toContainText('Rahul Sharma')
  await expect(page.getByRole('list',{ name: 'Sales history' })).toContainText('Paid')
  expect((await (await page.request.get(invoicePath)).json()).data).toEqual(original)
  const prescriptions=(await (await page.request.get(`/api/customers/${customer.uuid}/prescriptions`)).json()).data.prescriptions
  expect(prescriptions[0]).toMatchObject({ right_sphere: '-1.50',right_cylinder: '-0.50',right_axis: 90,left_sphere: '-1.25',left_cylinder: '-0.25',left_axis: 85 })
  await layout(page); expect(errors).toEqual([])
})

for (const stage of ['sale','payment','invoice'] as const) test(`checkout recovers an actually committed lost ${stage} response without duplicate writes`,async ({ page })=>{
  await signIn(page); await identity(page)
  const customer=await createCustomer(page,`Lost checkout ${stage}`,{ sale: '9890010001',payment: '9890010002',invoice: '9890010003' }[stage])
  await page.goto(`/sales/new?customer=${customer.uuid}`); await items(page)
  await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click()
  const pattern=stage==='sale' ? `**/api/customers/${customer.uuid}/purchases` : `**/api/customers/${customer.uuid}/purchases/*/${stage==='payment' ? 'payments' : 'invoice'}`
  let commits=0
  await page.route(pattern,async route=>{
    if (route.request().method()!=='POST') { await route.continue(); return }
    const response=await route.fetch(); expect(response.status()).toBe(201); commits++
    await route.abort('failed'); await page.unroute(pattern)
  })
  await page.getByRole('button',{ name: 'Complete Sale',exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('Payment amount (₹)',{ exact: true }),(await page.getByRole('alert').allTextContents()).join('\n')).toBeDisabled()
  await page.getByRole('button',{ name: 'Continue saved sale',exact: true }).click()
  await expect(heading(page,'Sale completed')).toBeVisible()
  expect(commits).toBe(1)
  const sales=(await (await page.request.get(`/api/sales?customer_uuid=${customer.uuid}`)).json()).data.sales
  expect(sales).toHaveLength(1)
  const payments=(await (await page.request.get(`/api/shop/payments?customer_uuid=${customer.uuid}`)).json()).data.payments
  expect(payments).toHaveLength(1); expect(payments[0].amount_paise).toBe(10000)
})

test('checkout payment rejection allows correction while reusing the committed sale',async ({ page })=>{
  await signIn(page); await identity(page)
  const customer=await createCustomer(page,'Checkout correction','9890010004')
  await page.goto(`/sales/new?customer=${customer.uuid}`); await items(page)
  await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click()
  // A real independent collector pays after sale commit, before the initial receipt.
  const purchasePath=`/api/customers/${customer.uuid}/purchases`
  await page.route(`**${purchasePath}`,async route=>{
    if (route.request().method()!=='POST') { await route.continue(); return }
    const sale=await route.fetch(); const record=(await sale.json()).data as PurchaseDetail
    const receipt=await page.request.post(`${purchasePath}/${record.uuid}/payments`,{ headers: await mutationHeaders(page),data: { client_request_id: crypto.randomUUID(),amount: '30',payment_method: 'cash' } })
    expect(receipt.status()).toBe(201); await route.fulfill({ response: sale }); await page.unroute(`**${purchasePath}`)
  })
  await page.getByRole('button',{ name: 'Complete Sale',exact: true }).click()
  await expect(page.locator('main')).toContainText('The sale is already saved.')
  await expect(page.getByLabel('Payment amount (₹)',{ exact: true })).toBeEnabled()
  await page.getByLabel('Payment amount (₹)',{ exact: true }).fill('70')
  await page.getByRole('button',{ name: 'Continue saved sale',exact: true }).click()
  await expect(heading(page,'Sale completed')).toBeVisible()
  await expect(page.getByTestId('completed-due')).toHaveText('₹0.00')
  expect((await (await page.request.get(`/api/sales?customer_uuid=${customer.uuid}`)).json()).data.sales).toHaveLength(1)
  expect((await (await page.request.get(`/api/shop/payments?customer_uuid=${customer.uuid}`)).json()).data.payments).toHaveLength(2)
})

test('collection handles multiple bills, dirty customer switching and a genuinely lost full receipt',async ({ page })=>{
  await page.setViewportSize({ width: 375,height: 812 }); await signIn(page)
  const customer=await createCustomer(page,'Multiple bill collector','9890010005'), headers=await mutationHeaders(page)
  const sales: PurchaseDetail[]=[]
  for (const amount of ['10','20']) {
    const response=await page.request.post(`/api/customers/${customer.uuid}/purchases`,{ headers,data: { client_request_id: crypto.randomUUID(),purchase_date: '2026-04-01',items: [{ description: `Bill ${amount}`,product_category: 'other',quantity: 1,unit_price: amount }] } })
    expect(response.status()).toBe(201); sales.push((await response.json()).data)
  }
  await page.goto(`/receive-payment?customer=${customer.uuid}`)
  const bills=page.getByRole('list',{ name: 'Choose sale to pay' }); await expect(bills.getByRole('listitem')).toHaveCount(2)
  await bills.getByRole('button',{ name: /₹10\.00 due/u }).click()
  await page.getByLabel('Payment amount (₹)',{ exact: true }).fill('5')
  await page.getByRole('link',{ name: 'Change customer',exact: true }).click()
  const guard=page.getByRole('dialog',{ name: 'Discard unsaved changes?',exact: true }); await expect(guard).toBeVisible()
  await guard.getByRole('button',{ name: 'Keep editing',exact: true }).click()
  await expect(page.getByLabel('Payment amount (₹)',{ exact: true })).toHaveValue('5')
  await page.getByRole('link',{ name: 'Change customer',exact: true }).click(); await guard.getByRole('button',{ name: 'Discard changes',exact: true }).click()
  await expect(page.getByLabel('Search customer',{ exact: true })).toBeVisible()
  await page.getByLabel('Search customer',{ exact: true }).fill(customer.name)
  await page.getByRole('button',{ name: `Select ${customer.name}`,exact: true }).click(); await bills.getByRole('button',{ name: /₹10\.00 due/u }).click()
  const path=`/api/customers/${customer.uuid}/purchases/${sales[0].uuid}/payments`
  let writes=0; page.on('request',request=>{ if (new URL(request.url()).pathname===path && request.method()==='POST') writes++ })
  await page.route(`**${path}`,async route=>{ const result=await route.fetch(); expect(result.status()).toBe(201); await route.abort('failed'); await page.unroute(`**${path}`) })
  await page.getByRole('button',{ name: 'Receive Payment',exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByLabel('Payment amount (₹)',{ exact: true })).toBeDisabled()
  await page.getByRole('button',{ name: 'Check / continue payment',exact: true }).click()
  await expect(heading(page,'Payment received')).toBeVisible(); await expect(page.getByTestId('received-remaining')).toHaveText('₹0.00')
  expect(writes).toBe(1)
  const result=(await (await page.request.get(`/api/shop/payments?customer_uuid=${customer.uuid}`)).json()).data.payments
  expect(result).toHaveLength(1); expect(result[0].amount_paise).toBe(1000); await layout(page)
})

test('collection refreshes a rejected stale balance and focuses the field for correction',async ({ page })=>{
  await signIn(page)
  const customer=await createCustomer(page,'Stale collector','9890010006'), headers=await mutationHeaders(page)
  const created=await page.request.post(`/api/customers/${customer.uuid}/purchases`,{ headers,data: { client_request_id: crypto.randomUUID(),purchase_date: '2026-04-01',items: [{ description: 'Stale balance fixture',product_category: 'other',quantity: 1,unit_price: '100' }] } })
  expect(created.status()).toBe(201); const sale=(await created.json()).data as PurchaseDetail
  await page.goto(`/receive-payment?customer=${customer.uuid}&sale=${sale.uuid}`)
  await page.getByLabel('Payment amount (₹)',{ exact: true }).fill('80')
  const path=`/api/customers/${customer.uuid}/purchases/${sale.uuid}/payments`
  expect((await page.request.post(path,{ headers,data: { client_request_id: crypto.randomUUID(),amount: '30',payment_method: 'upi' } })).status()).toBe(201)
  await page.getByRole('button',{ name: 'Receive Payment',exact: true }).click()
  await expect(page.getByTestId('collect-outstanding')).toHaveText('₹70.00 due')
  await expect(page.getByLabel('Payment amount (₹)',{ exact: true })).toBeFocused()
  await expect(page.getByLabel('Payment amount (₹)',{ exact: true })).toHaveValue('80')
  await page.getByLabel('Payment amount (₹)',{ exact: true }).fill('70')
  await page.getByRole('button',{ name: 'Receive Payment',exact: true }).click()
  await expect(page.getByTestId('received-remaining')).toHaveText('₹0.00')
  expect((await (await page.request.get(path)).json()).data.payments).toHaveLength(2)
})

test('inline saves cannot be dismissed while pending; validation, discounts, pay later and zero totals remain exact',async ({ page })=>{
  await page.setViewportSize({ width: 360,height: 800 }); await signIn(page); await identity(page); await page.goto('/sales/new')
  await page.getByRole('button',{ name: 'Add customer',exact: true }).click()
  const sheet=page.getByRole('dialog',{ name: 'Add customer',exact: true })
  await sheet.getByLabel('Full name',{ exact: true }).fill('Pending mobile draft')
  await sheet.getByLabel('Mobile number',{ exact: true }).fill('9890010007')
  let release=()=>{}; const gate=new Promise<void>(resolve=>{ release=resolve })
  await page.route('**/api/customers',async route=>{ if (route.request().method()!=='POST') { await route.continue(); return }; const saved=await route.fetch(); expect(saved.status()).toBe(201); await gate; await route.fulfill({ response: saved }); await page.unroute('**/api/customers') })
  await sheet.getByRole('button',{ name: 'Save & Continue',exact: true }).click()
  await expect(sheet.getByRole('button',{ name: 'Close Add customer' })).toBeDisabled()
  await page.keyboard.press('Escape'); await expect(sheet).toBeVisible(); release(); await expect(sheet).not.toBeVisible()
  const profile=(await (await page.request.get('/api/customers?search=9890010007')).json()).data.customers[0] as Customer
  const rxPath=`/api/customers/${profile.uuid}/prescriptions`
  await page.getByRole('button',{ name: 'New prescription',exact: true }).click()
  const rx=page.getByRole('dialog',{ name: 'New prescription',exact: true })
  await rx.getByLabel('Right SPH (D)',{ exact: true }).fill('-1.25')
  await page.route(`**${rxPath}`,async route=>{ if (route.request().method()!=='POST') { await route.continue(); return }; const result=await route.fetch(); expect(result.status()).toBe(201); await route.abort('failed'); await page.unroute(`**${rxPath}`) })
  await rx.getByRole('button',{ name: 'Save prescription & Continue',exact: true }).click()
  await expect(rx.getByRole('button',{ name: 'Save prescription & Continue',exact: true })).toBeDisabled()
  await rx.getByRole('button',{ name: 'Check saved prescriptions',exact: true }).click()
  await expect(rx).not.toBeVisible()
  const records=(await (await page.request.get(rxPath)).json()).data.prescriptions
  expect(records).toHaveLength(1); await page.getByLabel('Select prescription').selectOption(records[0].uuid)
  await items(page,'35'); const item=page.getByRole('group',{ name: 'Item 1',exact: true })
  await item.getByLabel('Quantity',{ exact: true }).fill('1.5')
  await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click()
  await expect(item.getByLabel('Quantity',{ exact: true })).toHaveAttribute('aria-invalid','true')
  await item.getByLabel('Quantity',{ exact: true }).fill('1')
  await item.getByText('Line discount',{ exact: true }).click(); await item.getByLabel('Line discount (₹)',{ exact: true }).fill('40')
  await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click()
  await expect(item.getByLabel('Line discount (₹)',{ exact: true })).toHaveAttribute('aria-invalid','true')
  await item.getByLabel('Line discount (₹)',{ exact: true }).fill('5')
  if (!await page.getByLabel('Sale discount (₹)',{ exact: true }).isVisible()) await page.getByText('Discount, date & notes',{ exact: true }).click()
  await page.getByLabel('Sale discount (₹)',{ exact: true }).fill('10')
  await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click(); await page.getByRole('button',{ name: 'Pay later',exact: true }).click()
  await expect(page.getByTestId('sale-total')).toHaveText('₹20.00'); await page.getByRole('button',{ name: 'Complete Sale',exact: true }).click()
  await expect(heading(page,'Sale completed')).toBeVisible(); await expect(page.getByTestId('completed-due')).toHaveText('₹20.00')
  await page.getByRole('button',{ name: 'New Sale',exact: true }).click(); await expect(page.getByLabel('Search customer',{ exact: true })).toHaveValue('')
  await page.getByLabel('Search customer',{ exact: true }).fill('Pending mobile draft'); await page.getByRole('button',{ name: 'Select Pending mobile draft',exact: true }).click()
  await items(page,'0'); await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click(); await page.getByRole('button',{ name: 'Complete Sale',exact: true }).click()
  await expect(page.getByTestId('completed-total')).toHaveText('₹0.00'); await expect(page.getByTestId('completed-due')).toHaveText('₹0.00'); await layout(page)
})

for (const viewport of [{ width: 360,height: 800 },{ width: 375,height: 812 },{ width: 390,height: 844 },{ width: 412,height: 915 },{ width: 768,height: 1024 },{ width: 1024,height: 768 },{ width: 1440,height: 900 }]) test(`${viewport.width}×${viewport.height}: navigation, sheets, forms, histories and operational screens fit`,async ({ page })=>{
  test.setTimeout(90000)
  const errors: string[]=[]; page.on('pageerror',error=>errors.push(error.message)); page.on('console',message=>{ if (message.type()==='error') errors.push(message.text()) })
  await page.setViewportSize(viewport); await signIn(page); await identity(page)
  const customer=await createCustomer(page,`Viewport ${viewport.width}`,`98900${String(viewport.width).padStart(5,'0')}`)
  const response=await page.request.post(`/api/customers/${customer.uuid}/purchases`,{ headers: await mutationHeaders(page),data: { client_request_id: crypto.randomUUID(),purchase_date: '2026-04-01',items: [{ description: 'Layout fixture',product_category: 'other',quantity: 1,unit_price: '10' }] } })
  expect(response.status()).toBe(201); const sale=(await response.json()).data as PurchaseDetail
  expect((await page.request.post(`/api/customers/${customer.uuid}/purchases/${sale.uuid}/invoice`,{ headers: await mutationHeaders(page),data: { client_request_id: crypto.randomUUID() } })).status()).toBe(201)
  for (const route of ['/dashboard','/customers','/customers/new','/sales','/outstanding','/more','/payments/history','/prescriptions','/reports','/settings',`/customers/${customer.uuid}`,`/customers/${customer.uuid}?tab=sales`,`/customers/${customer.uuid}?tab=prescriptions`,`/customers/${customer.uuid}?tab=payments`,`/customers/${customer.uuid}/purchases/${sale.uuid}`,`/customers/${customer.uuid}/purchases/${sale.uuid}/invoice`,`/receive-payment?customer=${customer.uuid}&sale=${sale.uuid}`]) {
    await page.goto(route); await expect(page.locator('main h1').first()).toBeVisible()
    await expect(page.locator('main [role="alert"]')).toHaveCount(0); await layout(page)
    if (route==='/dashboard') {
      await expect(page.getByTestId('dashboard-payments')).toBeVisible()
      for (const id of ['dashboard-sales','dashboard-payments','dashboard-outstanding']) expect(await page.getByTestId(id).evaluate(element=>{ const range=document.createRange(); range.selectNodeContents(element); return range.getClientRects().length })).toBe(1)
      await page.screenshot({ path: test.info().outputPath(`home-${viewport.width}.png`),fullPage: true })
    }
  }
  await page.goto('/sales/new'); await page.getByRole('button',{ name: 'Add customer',exact: true }).click()
  await expect(page.getByRole('dialog',{ name: 'Add customer' })).toBeVisible(); await layout(page)
  await page.keyboard.press('Escape'); await expect(page.getByRole('button',{ name: 'Add customer',exact: true })).toBeFocused()
  await page.getByLabel('Search customer',{ exact: true }).fill(customer.name)
  await page.getByRole('button',{ name: `Select ${customer.name}`,exact: true }).click(); await items(page)
  await page.getByRole('button',{ name: 'New prescription',exact: true }).click(); await layout(page)
  await page.keyboard.press('Escape'); await page.getByRole('button',{ name: 'Continue to payment',exact: true }).click(); await layout(page)
  await page.screenshot({ path: test.info().outputPath(`checkout-${viewport.width}.png`),fullPage: true })
  const primary=page.getByRole('button',{ name: 'Complete Sale',exact: true }); expect((await primary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const navigation=page.getByRole('navigation',{ name: viewport.width<1024 ? 'Mobile primary navigation' : 'Primary navigation',exact: true })
  await navigation.getByRole('link',{ name: 'Home',exact: true }).click()
  const dialog=page.getByRole('dialog',{ name: 'Discard unsaved changes?',exact: true }); await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button',{ name: 'Keep editing',exact: true })).toBeFocused(); await layout(page)
  await dialog.getByRole('button',{ name: 'Discard changes',exact: true }).click(); await expect(heading(page,'Home')).toBeVisible()
  expect(errors).toEqual([])
})
