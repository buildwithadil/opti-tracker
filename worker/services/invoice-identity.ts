import type { InvoiceIdentity } from '../../shared/invoices.js'
import { invoiceIdentitySchema, type InvoiceIdentityInput } from '../../shared/invoiceValidation.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import type { PaymentActor } from './payments.js'

const columns = 'shop_name,address,contact_number,gstin,updated_at'
export async function getInvoiceIdentity(db: D1Database): Promise<InvoiceIdentity> {
  const row = await db.prepare(`SELECT ${columns} FROM shop_settings WHERE singleton_slot=1`).first<InvoiceIdentity>()
  if (!row) throw new HttpError(409, 'SHOP_NOT_CONFIGURED', 'The shop information is unavailable.')
  return row
}
export async function updateInvoiceIdentity(db: D1Database, input: InvoiceIdentityInput, actor: PaymentActor): Promise<InvoiceIdentity> {
  const values = invoiceIdentitySchema.parse(input)
  const now = new Date(Math.max(Date.now(), Date.parse(values.updated_at) + 1)).toISOString()
  const results = await runD1Batch(db, [
    db.prepare('UPDATE shop_settings SET shop_name=?,address=?,contact_number=?,gstin=?,updated_at=? WHERE singleton_slot=1 AND updated_at=?')
      .bind(values.shop_name, values.address, values.contact_number, values.gstin, now, values.updated_at),
    db.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json,request_id,created_at)
      SELECT ?,?,'update_invoice_identity','shop_settings',uuid,'{"fields":["shop_name","address","contact_number","gstin"]}',?,?
      FROM shop_settings WHERE singleton_slot=1 AND changes()=1`).bind(crypto.randomUUID(), actor.adminId, actor.requestId, now),
    db.prepare(`SELECT ${columns} FROM shop_settings WHERE singleton_slot=1`),
  ])
  if (results[0].meta.changes !== 1) throw new HttpError(409, 'SHOP_CHANGED', 'The business information changed. Reload it before saving again.')
  return results[2].results[0] as unknown as InvoiceIdentity
}
