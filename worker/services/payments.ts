import type { Payment, PaymentCreated, PaymentList } from '../../shared/payments.js'
import { paymentCreateSchema, type PaymentCreateInput, type PaymentListOptions } from '../../shared/paymentValidation.js'
import { parseRupeesToPaise } from '../../shared/money.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import { paymentBalanceColumns, paymentBalanceJoin, paymentCustomer, paymentPurchase, validPaymentSummary, type BalanceRow } from './payment-balances.js'

export interface PaymentActor { adminId: string; requestId: string }
const columns = `m.id AS uuid,m.purchase_id AS purchase_uuid,m.customer_id AS customer_uuid,m.amount_paise,
  m.payment_method,m.status,m.received_at,m.reference,m.notes,m.created_at`
const summarySql = `SELECT p.total_paise,${paymentBalanceColumns} FROM purchases AS p ${paymentBalanceJoin}
  WHERE p.customer_id = ? AND p.id = ?`
const duplicate = () => new HttpError(409, 'PAYMENT_DUPLICATE', 'This payment submission has already been recorded. Open payment history before recording another payment.')

export async function listPayments(db: D1Database, customerUuid: string, purchaseUuid: string, query: PaymentListOptions): Promise<PaymentList> {
  await paymentCustomer(db, customerUuid)
  const results = await runD1Batch(db, [
    db.prepare(`SELECT ${columns} FROM payments AS m JOIN purchases AS p ON p.id = m.purchase_id
      WHERE p.customer_id = ? AND p.id = ? AND m.customer_id = ?
      ORDER BY m.received_at,m.created_at,m.id LIMIT ? OFFSET ?`).bind(customerUuid, purchaseUuid, customerUuid, query.pageSize, (query.page - 1) * query.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM payments AS m JOIN purchases AS p ON p.id = m.purchase_id
      WHERE p.customer_id = ? AND p.id = ? AND m.customer_id = ?`).bind(customerUuid, purchaseUuid, customerUuid),
    db.prepare(summarySql).bind(customerUuid, purchaseUuid),
  ])
  const summary = results[2].results[0] as BalanceRow | undefined
  if (!summary) throw new HttpError(404, 'PURCHASE_NOT_FOUND', 'The purchase was not found for this customer.')
  const total = (results[1].results[0] as { total: number }).total
  return { payments: results[0].results as Payment[], purchase_summary: validPaymentSummary(summary), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } }
}
export async function getPayment(db: D1Database, customerUuid: string, purchaseUuid: string, paymentUuid: string): Promise<Payment> {
  await paymentCustomer(db, customerUuid)
  await paymentPurchase(db, customerUuid, purchaseUuid)
  const row = await db.prepare(`SELECT ${columns} FROM payments AS m JOIN purchases AS p ON p.id = m.purchase_id
    WHERE p.customer_id = ? AND p.id = ? AND m.customer_id = ? AND m.id = ?`).bind(customerUuid, purchaseUuid, customerUuid, paymentUuid).first<Payment>()
  if (!row) throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'The payment was not found for this purchase and customer.')
  return row
}
export async function createPayment(db: D1Database, customerUuid: string, purchaseUuid: string, input: PaymentCreateInput, actor: PaymentActor): Promise<PaymentCreated> {
  const values = paymentCreateSchema.parse(input)
  await paymentCustomer(db, customerUuid)
  const purchase = await paymentPurchase(db, customerUuid, purchaseUuid)
  // No client or preliminary balance determines whether money may commit.
  // The INSERT trigger checks duplicates, ownership, active state, date and
  // outstanding balance while holding D1's serialized write transaction.
  validPaymentSummary(purchase)
  const uuid = crypto.randomUUID(), auditUuid = crypto.randomUUID(), now = new Date().toISOString()
  const results = await runPaymentBatch(db, [
    db.prepare(`INSERT INTO payments(id,purchase_id,customer_id,amount_paise,payment_method,status,received_at,settled_at,
      reference,notes,created_at,updated_at,created_by_admin_id,updated_by_admin_id,client_request_id,creation_audit_id)
      VALUES (?,?,?,?,?,'settled',?,?,?,?,?,?,?,?,?,?)`).bind(uuid, purchaseUuid, customerUuid, parseRupeesToPaise(values.amount), values.payment_method,
        values.received_at, values.received_at, values.reference, values.notes, now, now, actor.adminId, actor.adminId, values.client_request_id, auditUuid),
    db.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,after_json,request_id,created_at)
      SELECT ?,?,'create','payment',m.id,json_object('uuid',m.id,'purchase_uuid',m.purchase_id,'customer_uuid',m.customer_id,
        'amount_paise',m.amount_paise,'payment_method',m.payment_method,'received_at',m.received_at,'created_at',m.created_at),?,?
      FROM payments AS m WHERE m.id = ? AND m.purchase_id = ? AND m.customer_id = ?`)
      .bind(auditUuid, actor.adminId, actor.requestId, now, uuid, purchaseUuid, customerUuid),
    db.prepare(`SELECT ${columns} FROM payments AS m JOIN purchases AS p ON p.id = m.purchase_id
      WHERE p.customer_id = ? AND p.id = ? AND m.customer_id = ? AND m.id = ?`).bind(customerUuid, purchaseUuid, customerUuid, uuid),
    db.prepare(summarySql).bind(customerUuid, purchaseUuid),
  ])
  return { payment: results[2].results[0] as Payment, purchase_summary: validPaymentSummary(results[3].results[0] as BalanceRow) }
}
async function runPaymentBatch(db: D1Database, statements: D1PreparedStatement[]) {
  try { return await runD1Batch(db, statements) }
  catch (error) {
    if (!(error instanceof Error)) throw error
    if (/duplicate payment submission|UNIQUE constraint failed: payments.customer_id, payments.client_request_id/u.test(error.message)) throw duplicate()
    if (/payment exceeds outstanding balance/u.test(error.message)) throw new HttpError(409, 'PAYMENT_EXCEEDS_OUTSTANDING', 'The payment exceeds the current outstanding balance. Refresh the purchase and enter a smaller amount.', [{ field: 'amount', message: 'Payment cannot exceed the current outstanding balance.' }])
    if (/payment customer is archived/u.test(error.message)) throw new HttpError(409, 'CUSTOMER_ARCHIVED', 'Restore the customer before recording a payment.')
    if (/purchase cannot receive payments/u.test(error.message)) throw new HttpError(409, 'PURCHASE_NOT_PAYABLE', 'This historical purchase cannot receive payments.')
    if (/invalid payment date/u.test(error.message)) throw new HttpError(400, 'INVALID_INPUT', 'The payment time must be on or after the purchase date (UTC) and cannot be in the future.', [{ field: 'received_at', message: 'Use a valid time on or after the purchase date (UTC), up to the present.' }])
    if (/invalid existing payment balance/u.test(error.message)) throw new HttpError(409, 'FINANCIAL_DATA_INVALID', 'The existing financial records require review before another payment can be recorded.')
    throw error
  }
}
