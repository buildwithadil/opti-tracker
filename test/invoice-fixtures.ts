import { paymentFixture } from './payment-fixtures'
import { bindings } from './helpers'
import { getInvoiceIdentity, updateInvoiceIdentity } from '../worker/services/invoice-identity'

export async function invoiceFixture(total = '5000.00') {
  const fixture = await paymentFixture(total)
  const identity = await getInvoiceIdentity(bindings.DB)
  await updateInvoiceIdentity(bindings.DB, { shop_name: 'Original Optical Shop', address: '42 Market Road\nPune 411001', contact_number: '+91 20 2345 6789', gstin: '27ABCDE1234F1Z5', updated_at: identity.updated_at }, fixture.actor)
  return fixture
}
