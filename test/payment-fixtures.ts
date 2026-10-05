import { createCustomer } from '../worker/services/customers'
import { createPurchase } from '../worker/services/purchases'
import { bindings, setup } from './helpers'

export const paymentInput = (amount = '100.00', method: 'cash' | 'upi' | 'card' = 'cash', key = crypto.randomUUID()) => ({ client_request_id: key, amount, payment_method: method, received_at: '2026-04-09T12:30:00.000Z', reference: 'Test ref', notes: 'Private payment note' })
export async function paymentFixture(total = '5000.00') {
  const owner = await setup()
  const actor = { adminId: owner.data.id, requestId: crypto.randomUUID() }
  const customer = await createCustomer(bindings.DB, { name: 'Payment customer', phone: '+919876543210' }, actor)
  const purchase = await paymentPurchaseFixture(customer.uuid, total, actor)
  return { owner, actor, customer, purchase }
}
export function paymentPurchaseFixture(customerUuid: string, total: string, actor: { adminId: string; requestId: string }) {
  return createPurchase(bindings.DB, customerUuid, { client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', items: [{ description: 'Original financial snapshot', product_category: 'spectacle_frames', quantity: 1, unit_price: total }] }, actor)
}
