import type { Invoice, InvoiceSnapshot } from '../../shared/invoices.js'
import { invoiceGenerateSchema } from '../../shared/invoiceValidation.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import { paymentCustomer, paymentPurchase, validPaymentSummary } from './payment-balances.js'
import type { PaymentActor } from './payments.js'

interface InvoiceRow extends Omit<Invoice, 'snapshot'> { snapshot_json: string }
const columns = 'uuid,purchase_uuid,customer_uuid,invoice_number,issued_at,snapshot_json'
function publicInvoice(row: InvoiceRow): Invoice { const { snapshot_json, ...record } = row; return { ...record, snapshot: JSON.parse(snapshot_json) as InvoiceSnapshot } }
async function existing(db: D1Database, customerUuid: string, purchaseUuid: string): Promise<Invoice | null> {
  const row = await db.prepare(`SELECT ${columns} FROM invoices WHERE customer_uuid=? AND purchase_uuid=?`).bind(customerUuid, purchaseUuid).first<InvoiceRow>()
  return row ? publicInvoice(row) : null
}
export async function getInvoice(db: D1Database, customerUuid: string, purchaseUuid: string): Promise<Invoice | null> {
  await paymentCustomer(db, customerUuid)
  // Historical retrieval needs ownership only, never a future/live balance view.
  const purchase = await db.prepare('SELECT id FROM purchases WHERE id=? AND customer_id=?').bind(purchaseUuid, customerUuid).first()
  if (!purchase) throw new HttpError(404, 'PURCHASE_NOT_FOUND', 'The purchase was not found for this customer.')
  return existing(db, customerUuid, purchaseUuid)
}
export async function generateInvoice(db: D1Database, customerUuid: string, purchaseUuid: string, input: { client_request_id: string }, actor: PaymentActor): Promise<{ invoice: Invoice; created: boolean }> {
  const values = invoiceGenerateSchema.parse(input)
  const previous = await getInvoice(db, customerUuid, purchaseUuid)
  if (previous) return { invoice: previous, created: false }
  const customer = await paymentCustomer(db, customerUuid), purchase = await paymentPurchase(db, customerUuid, purchaseUuid)
  if (customer.archived_at) throw new HttpError(409, 'CUSTOMER_ARCHIVED', 'Restore the customer before generating an invoice.')
  if (purchase.deleted_at || ['void', 'refunded'].includes(purchase.status) || purchase.currency_code !== 'INR') throw new HttpError(409, 'PURCHASE_NOT_INVOICEABLE', 'This historical purchase cannot receive a new invoice.')
  validPaymentSummary(purchase)
  const reservationUuid = crypto.randomUUID(), reservationAudit = crypto.randomUUID(), now = new Date().toISOString()
  let reservation: { uuid: string; purchase_uuid: string } | undefined
  try {
    const results = await runD1Batch(db, [
      db.prepare(`INSERT INTO invoice_number_reservations(uuid,purchase_uuid,customer_uuid,shop_uuid,client_request_id,sequence_number,invoice_number,created_at,created_by_admin_id,creation_audit_id)
        SELECT ?,?,?,uuid,?,next_invoice_number,invoice_prefix || '-' || printf('%0*d',invoice_number_padding,next_invoice_number),?,?,?
        FROM shop_settings WHERE singleton_slot=1 AND NOT EXISTS(SELECT 1 FROM invoices WHERE customer_uuid=? AND purchase_uuid=?)
          AND NOT EXISTS(SELECT 1 FROM invoice_number_reservations WHERE customer_uuid=? AND client_request_id=?)`)
        .bind(reservationUuid, purchaseUuid, customerUuid, values.client_request_id, now, actor.adminId, reservationAudit, customerUuid, purchaseUuid, customerUuid, values.client_request_id),
      db.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json,request_id,created_at)
        SELECT ?,?,'reserve','invoice_number',uuid,json_object('purchase_uuid',purchase_uuid,'customer_uuid',customer_uuid,'invoice_number',invoice_number,'sequence_number',sequence_number),?,?
        FROM invoice_number_reservations WHERE uuid=?`).bind(reservationAudit, actor.adminId, actor.requestId, now, reservationUuid),
      db.prepare('SELECT uuid,purchase_uuid FROM invoice_number_reservations WHERE customer_uuid=? AND client_request_id=?').bind(customerUuid, values.client_request_id),
    ])
    reservation = results[2].results[0] as typeof reservation
    // D1 meta.changes includes the counter UPDATE in the AFTER INSERT trigger.
    // Identity, rather than that count, tells us whether this attempt reserved.
    if (reservation?.uuid !== reservationUuid) {
      const winner = await existing(db, customerUuid, purchaseUuid)
      if (winner) return { invoice: winner, created: false }
      throw new HttpError(409, 'INVOICE_GENERATION_INCOMPLETE', 'The previous attempt reserved a number without issuing this invoice. That number is retained. Generate again with a new submission to reserve a new number.')
    }
  } catch (error) { rethrowInvoiceError(error) }
  if (!reservation || reservation.purchase_uuid !== purchaseUuid) throw new HttpError(409, 'INVOICE_GENERATION_INCOMPLETE', 'The previous submission reserved a number. Use a new invoice submission.')
  const invoiceUuid = crypto.randomUUID(), auditUuid = crypto.randomUUID()
  try {
    const results = await runD1Batch(db, [
      db.prepare(`INSERT INTO invoices(uuid,purchase_uuid,customer_uuid,reservation_uuid,invoice_number,issued_at,snapshot_json,created_by_admin_id,creation_audit_id)
        SELECT ?,v.purchase_uuid,v.customer_uuid,r.uuid,r.invoice_number,strftime('%Y-%m-%dT%H:%M:%fZ','now'),v.snapshot_json,?,?
        FROM invoice_source_snapshots AS v JOIN invoice_number_reservations AS r ON r.purchase_uuid=v.purchase_uuid AND r.customer_uuid=v.customer_uuid
        WHERE r.uuid=? AND v.customer_uuid=? AND v.purchase_uuid=?
          AND NOT EXISTS(SELECT 1 FROM invoices WHERE purchase_uuid=v.purchase_uuid)`)
        .bind(invoiceUuid, actor.adminId, auditUuid, reservation.uuid, customerUuid, purchaseUuid),
      db.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json,request_id,created_at)
        SELECT ?,?,'create','invoice',uuid,json_object('uuid',uuid,'purchase_uuid',purchase_uuid,'customer_uuid',customer_uuid,'invoice_number',invoice_number,'issued_at',issued_at),?,issued_at
        FROM invoices WHERE uuid=?`).bind(auditUuid, actor.adminId, actor.requestId, invoiceUuid),
      db.prepare(`SELECT ${columns} FROM invoices WHERE customer_uuid=? AND purchase_uuid=?`).bind(customerUuid, purchaseUuid),
    ])
    const row = results[2].results[0] as unknown as InvoiceRow | undefined
    if (!row) throw new HttpError(409, 'INVOICE_GENERATION_INCOMPLETE', 'A number was reserved but the invoice could not be issued. Its number is retained; use a new submission to retry.')
    return { invoice: publicInvoice(row), created: results[0].meta.changes === 1 }
  } catch (error) { rethrowInvoiceError(error) }
}
function rethrowInvoiceError(error: unknown): never {
  if (error instanceof HttpError) throw error
  if (error instanceof Error) {
    if (/invoice shop configuration|sequence_number|sequence cannot/u.test(error.message)) throw new HttpError(409, 'INVOICE_CONFIGURATION_REQUIRED', 'Complete the invoice business information and verify the supported never-reset invoice sequence before generating.')
    if (/conflicts with legacy invoice|invoice number reservation already exists/u.test(error.message)) throw new HttpError(409, 'INVOICE_SEQUENCE_REVIEW', 'The next number conflicts with a historical or reserved invoice. Reconcile the invoice sequence before generating; no historical number will be reused.')
    if (/purchase cannot receive|invalid invoice reservation/u.test(error.message)) throw new HttpError(409, 'PURCHASE_NOT_INVOICEABLE', 'This purchase cannot receive a new invoice. Restore an archived customer or review its historical invoice state.')
    if (/invalid invoice financial/u.test(error.message)) throw new HttpError(409, 'FINANCIAL_DATA_INVALID', 'The existing financial records require review before an invoice can be issued. Any reserved number is retained.')
  }
  throw error
}
