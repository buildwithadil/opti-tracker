import { createCustomer, archiveCustomer } from '../worker/services/customers'
import { createPurchase } from '../worker/services/purchases'
import { createPayment } from '../worker/services/payments'
import type { PurchaseCategory } from '../shared/purchases'
import { bindings, setup } from './helpers'

export async function reportFixture() {
  const owner = await setup(), actor = { adminId: owner.data.id, requestId: crypto.randomUUID() }
  const a = await createCustomer(bindings.DB, { name: 'Asha, "देवी"', phone: '+919876543210' }, actor)
  const b = await createCustomer(bindings.DB, { name: 'Archived debtor', phone: '+919123456780' }, actor)
  const c = await createCustomer(bindings.DB, { name: 'No purchases', phone: '+918123456789' }, actor)
  const sale = (customer: string, date: string, price: string, category: PurchaseCategory) => createPurchase(bindings.DB, customer, { client_request_id: crypto.randomUUID(), purchase_date: date, items: [{ description: 'Private product description', product_category: category, quantity: 1, unit_price: price }], notes: 'Private purchase note' }, actor)
  const first = await createPurchase(bindings.DB, a.uuid, { client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', order_discount: '20', items: [
    { description: 'Frame snapshot', product_category: 'spectacle_frames', quantity: 2, unit_price: '50', discount: '10' },
    { description: 'Lens snapshot', product_category: 'prescription_lenses', quantity: 1, unit_price: '100' },
  ] }, actor)
  const full = await sale(a.uuid, '2026-04-09', '100.01', 'sunglasses'), debt = await sale(b.uuid, '2026-04-08', '50', 'reading_glasses'), zero = await sale(a.uuid, '2026-04-08', '0', 'other')
  const pay = (customer: string, purchase: string, amount: string, method: 'cash' | 'upi' | 'card', time: string) => createPayment(bindings.DB, customer, purchase, { client_request_id: crypto.randomUUID(), amount, payment_method: method, received_at: time, reference: 'Private payment reference', notes: 'Private payment note' }, actor)
  await pay(a.uuid, first.uuid, '50.01', 'cash', '2026-04-08T18:29:59.999Z')
  await pay(a.uuid, first.uuid, '19.99', 'upi', '2026-04-08T18:30:00.000Z')
  await pay(a.uuid, first.uuid, '30', 'card', '2026-04-09T18:29:59.999Z')
  await pay(a.uuid, first.uuid, '10', 'cash', '2026-04-09T18:30:00.000Z')
  await pay(a.uuid, full.uuid, '100.01', 'card', '2026-04-09T12:00:00.000Z')
  await pay(b.uuid, debt.uuid, '20', 'upi', '2026-04-08T12:00:00.000Z')
  await archiveCustomer(bindings.DB, b.uuid, actor)
  return { owner, actor, a, b, c, first, full, debt, zero }
}

/** Complete audited fixtures in disposable D1, with real production guards. */
export async function reportVolume(customer: string, owner: string, count: number) {
  for (let start = 0; start < count; start += 250) {
    const records = JSON.stringify(Array.from({ length: Math.min(250,count-start) }, () => ({ id: crypto.randomUUID(), key: crypto.randomUUID(), audit: crypto.randomUUID() })))
    await bindings.DB.batch([
      bindings.DB.prepare(`INSERT INTO purchases(id,customer_id,purchase_date,subtotal_paise,taxable_amount_paise,total_paise,item_count,creation_audit_id,client_request_id,created_by_admin_id)
        SELECT json_extract(value,'$.id'),?,'2026-04-08',101,101,101,1,json_extract(value,'$.audit'),json_extract(value,'$.key'),? FROM json_each(?)`).bind(customer,owner,records),
      bindings.DB.prepare(`INSERT INTO purchase_items(id,purchase_id,description,product_category,quantity,unit_price_paise,line_total_paise,taxable_paise,snapshot_position)
        SELECT json_extract(value,'$.id')||'-item',json_extract(value,'$.id'),'Volume snapshot','other',1,101,101,101,0 FROM json_each(?)`).bind(records),
      bindings.DB.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id)
        SELECT json_extract(value,'$.audit'),?,'create','purchase',json_extract(value,'$.id') FROM json_each(?)`).bind(owner,records),
    ])
  }
}
