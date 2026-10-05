import type { CustomerCreditSummary, PaymentSummary } from '../../shared/payments.js'
import { asPaise, subtractPaise } from '../../shared/money.js'
import { HttpError } from '../lib/errors.js'

export interface BalanceRow extends PaymentSummary { invalid_payment: number; legacy_reversal: number }
export const paymentBalanceColumns = 'b.amount_paid_paise,b.outstanding_paise,b.payment_status,b.invalid_payment,b.legacy_reversal'
export const paymentBalanceJoin = 'JOIN purchase_payment_balances AS b ON b.purchase_uuid = p.id AND b.customer_uuid = p.customer_id'
export function validPaymentSummary(row: BalanceRow): PaymentSummary {
  try {
    if (row.invalid_payment || row.legacy_reversal) throw new RangeError('Unsupported legacy balance')
    const total = asPaise(row.total_paise), paid = asPaise(row.amount_paid_paise)
    const outstanding = subtractPaise(total, paid)
    if (outstanding !== row.outstanding_paise) throw new RangeError('Inconsistent balance')
    return { total_paise: total, amount_paid_paise: paid, outstanding_paise: outstanding, payment_status: paid === total ? 'paid' : paid === 0 ? 'unpaid' : 'partially_paid' }
  } catch { throw new HttpError(409, 'FINANCIAL_DATA_INVALID', 'The existing financial records require review before a balance can be shown or another payment recorded.') }
}
export async function paymentCustomer(db: D1Database, customerUuid: string) {
  const row = await db.prepare('SELECT uuid,archived_at FROM customers WHERE uuid = ?').bind(customerUuid).first<{ uuid: string; archived_at: string | null }>()
  if (!row) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'The customer was not found.')
  return row
}
export interface PaymentPurchaseState extends BalanceRow { purchase_uuid: string; customer_uuid: string; purchase_date: string; status: string; currency_code: string; deleted_at: string | null }
export async function paymentPurchase(db: D1Database, customerUuid: string, purchaseUuid: string): Promise<PaymentPurchaseState> {
  const row = await db.prepare(`SELECT p.id AS purchase_uuid,p.customer_id AS customer_uuid,p.total_paise,
    COALESCE(p.purchase_date,substr(p.created_at,1,10)) AS purchase_date,p.status,p.currency_code,p.deleted_at,${paymentBalanceColumns}
    FROM purchases AS p ${paymentBalanceJoin} WHERE p.customer_id = ? AND p.id = ?`).bind(customerUuid, purchaseUuid).first<PaymentPurchaseState>()
  if (!row) throw new HttpError(404, 'PURCHASE_NOT_FOUND', 'The purchase was not found for this customer.')
  return row
}
export async function customerCreditSummary(db: D1Database, customerUuid: string): Promise<CustomerCreditSummary> {
  await paymentCustomer(db, customerUuid)
  // Split integer sums before aggregation, then reconstruct with BigInt. This
  // avoids floating SUM(), JS rounding and SQL 64-bit overflow on large totals.
  const row = await db.prepare(`SELECT
    CAST(COALESCE(SUM(outstanding_paise / 1000000000),0) AS TEXT) AS whole,
    CAST(COALESCE(SUM(outstanding_paise % 1000000000),0) AS TEXT) AS remainder,
    COALESCE(MAX(CASE WHEN invalid_payment OR legacy_reversal OR typeof(total_paise) <> 'integer'
      OR total_paise > 9007199254740991 OR outstanding_paise < 0 THEN 1 ELSE 0 END),0) AS invalid
    FROM purchase_payment_balances WHERE customer_uuid = ?`).bind(customerUuid).first<{ whole: string; remainder: string; invalid: number }>()
  if (row!.invalid) throw new HttpError(409, 'FINANCIAL_DATA_INVALID', 'The existing financial records require review before customer credit can be shown.')
  try {
    const amount = BigInt(row!.whole) * 1000000000n + BigInt(row!.remainder)
    return { customer_uuid: customerUuid, outstanding_paise: asPaise(Number(amount)) }
  } catch { throw new HttpError(409, 'CREDIT_TOTAL_OUT_OF_RANGE', 'The customer outstanding total is outside the supported integer-paise range.') }
}
