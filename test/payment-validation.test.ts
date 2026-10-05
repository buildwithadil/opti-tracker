import { describe, expect, it } from 'vitest'
import { paymentCreateSchema, paymentListSchema, paymentPathSchema } from '../shared/paymentValidation'
import { paymentFormSchema, localPaymentTime } from '../src/lib/paymentValidation'
import { paymentInput } from './payment-fixtures'

describe('shared exact payment validation and browser date adaptation', () => {
  it.each(['cash', 'upi', 'card'] as const)('accepts controlled method %s with exact rupee text', method => {
    expect(paymentCreateSchema.parse(paymentInput('100.50', method))).toMatchObject({ amount: '100.50', payment_method: method })
  })
  it.each(['0', '0.00', '-1', '+1', '1.001', '.5', '1.', '1e2', '1,000', '', 'NaN', '90071992547409.92', 100, null, true, [], {}])('rejects invalid amount %j without rounding/coercion', amount => {
    expect(paymentCreateSchema.safeParse({ ...paymentInput(), amount }).success).toBe(false)
  })
  it.each(['Cash', 'UPI', 'bank_transfer', 'other', '', null, 1, []])('rejects invalid method %j', payment_method => {
    expect(paymentCreateSchema.safeParse({ ...paymentInput(), payment_method }).success).toBe(false)
  })
  it.each(['2026-02-30T12:00:00.000Z', '2025-02-29T12:00:00.000Z', '2026-04-09', '2026-04-09T12:00:00Z', '2026-04-09T12:00:00.000+00:00', '0000-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', '', null])('rejects malformed/impossible/future timestamp %j', received_at => {
    expect(paymentCreateSchema.safeParse({ ...paymentInput(), received_at }).success).toBe(false)
  })
  it.each(['amount_paise', 'amount_paid_paise', 'outstanding_paise', 'payment_status', 'purchase_uuid', 'customer_uuid', 'status', 'refund'])('rejects forged or unsupported field %s', key => {
    expect(paymentCreateSchema.safeParse({ ...paymentInput(), [key]: 1 }).success).toBe(false)
  })
  it.each([{ client_request_id: undefined }, { client_request_id: 'bad' }, { notes: '\u0000' }, { notes: 'x'.repeat(2001) }, { reference: 'bad\nref' }, { reference: 'x'.repeat(201) }])('rejects malformed text/submission %j', patch => {
    expect(paymentCreateSchema.safeParse({ ...paymentInput(), ...patch }).success).toBe(false)
  })
  it('retains minimum/maximum amounts, trims optional fields and supplies canonical current time', () => {
    for (const amount of ['0.01', '90071992547409.91']) expect(paymentCreateSchema.parse(paymentInput(amount)).amount).toBe(amount)
    const result = paymentCreateSchema.parse({ ...paymentInput(), reference: '  ', notes: '  ', received_at: undefined })
    expect(result.reference).toBeNull(); expect(result.notes).toBeNull()
    expect(result.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  })
  it('adapts local form time to UTC and validates positive partial amounts, outstanding and purchase date', () => {
    const form = { ...paymentInput('25.50'), received_at: localPaymentTime('2026-04-09T12:30:00.000Z') }
    expect(paymentFormSchema(10000, '2026-04-08').parse(form).received_at).toBe('2026-04-09T12:30:00.000Z')
    for (const patch of [{ amount: '100.01' }, { amount: '0' }, { received_at: '2026-02-30T12:00' }, { received_at: localPaymentTime('2026-04-07T23:59:00.000Z') }]) expect(paymentFormSchema(10000, '2026-04-08').safeParse({ ...form, ...patch }).success).toBe(false)
    expect(paymentPathSchema.safeParse({ customerUuid: crypto.randomUUID(), purchaseUuid: crypto.randomUUID(), paymentUuid: 'bad' }).success).toBe(false)
  })
  it.each([{ page: '0' }, { page: '10001' }, { pageSize: '51' }, { page: '1.5' }, { category: 'cash' }, { status: 'paid' }])('rejects invalid history query %j', query => {
    expect(paymentListSchema.safeParse(query).success).toBe(false)
  })
})
