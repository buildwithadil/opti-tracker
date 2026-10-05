import { describe, expect, it } from 'vitest'
import { purchaseAmounts, purchaseCreateSchema, purchaseItemSchema, purchaseListSchema } from '../shared/purchaseValidation'
import { purchaseCategories } from '../shared/purchases'
import { formatPaise, asPaise, parseRupeesToPaise } from '../shared/money'
import { purchaseFormSchema } from '../src/lib/purchaseValidation'

const item = { description: 'Original frame', product_category: 'spectacle_frames', quantity: 1, unit_price: '10.00', discount: '0' }
const body = () => ({ client_request_id: crypto.randomUUID(), purchase_date: '2026-04-08', items: [item], order_discount: '0' })
describe('strict purchase input and exact shared money', () => {
  it.each(purchaseCategories)('accepts supported optical category %s', product_category => {
    expect(purchaseItemSchema.parse({ ...item, product_category }).product_category).toBe(product_category)
  })
  it.each([0, -1, 1.5, '2', null, true, 100001, Number.MAX_SAFE_INTEGER, Infinity, NaN])('rejects invalid quantity %j', quantity => {
    expect(purchaseCreateSchema.safeParse({ ...body(), items: [{ ...item, quantity }] }).success).toBe(false)
  })
  it.each(['', '-1', '+1', '.5', '1.', '1.001', '1e3', '1,000', 'NaN', 'Infinity', '90071992547409.92', 1.25, null, true, {}, []])('rejects invalid price/discount %j without rounding or numeric coercion', amount => {
    for (const field of ['unit_price', 'discount', 'order_discount']) {
      const input = field === 'order_discount' ? { ...body(), [field]: amount } : { ...body(), items: [{ ...item, [field]: amount }] }
      expect(purchaseCreateSchema.safeParse(input).success).toBe(false)
    }
  })
  it.each(['2025-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '0000-01-01', '2026-01-00', '26-01-01', '2026-1-1', '', null])('rejects invalid purchase date %j', purchase_date => {
    expect(purchaseCreateSchema.safeParse({ ...body(), purchase_date }).success).toBe(false)
  })
  it.each(['total_paise', 'subtotal_paise', 'discount_paise', 'tax_paise', 'invoice_number', 'payment', 'customer_uuid'])('rejects forged or out-of-scope header field %s', field => {
    expect(purchaseCreateSchema.safeParse({ ...body(), [field]: 1 }).success).toBe(false)
  })
  it.each(['line_total_paise', 'uuid', 'sku', 'line_type', 'tax_rate_basis_points', 'tax_type', 'hsn_sac_code', 'prescription_uuid'])('rejects forged or out-of-scope item field %s', field => {
    expect(purchaseCreateSchema.safeParse({ ...body(), items: [{ ...item, [field]: 'test' }] }).success).toBe(false)
  })
  it.each([{ items: [] }, { items: Array.from({ length: 101 }, () => item) }, { client_request_id: undefined }, { client_request_id: 'bad' }, { prescription_uuid: 'bad' }, { notes: 'private\u0000' }, { notes: 'x'.repeat(2001) }])('rejects malformed body %j', patch => {
    expect(purchaseCreateSchema.safeParse({ ...body(), ...patch }).success).toBe(false)
  })
  it('checks description/category boundaries, fixed discounts, line/sum overflow and full discount to zero', () => {
    for (const patch of [{ description: ' ' }, { description: 'x'.repeat(501) }, { description: 'Text\nline' }, { product_category: 'inventory' }, { discount: '10.01' }, { quantity: 2, unit_price: '90071992547409.91' }]) expect(purchaseItemSchema.safeParse({ ...item, ...patch }).success).toBe(false)
    expect(purchaseCreateSchema.safeParse({ ...body(), order_discount: '10.01' }).success).toBe(false)
    expect(purchaseCreateSchema.safeParse({ ...body(), items: [{ ...item, unit_price: '90071992547409.91' }, item] }).success).toBe(false)
    const maximum = purchaseCreateSchema.parse({ ...body(), items: [{ ...item, unit_price: '90071992547409.91' }] })
    expect(purchaseAmounts(maximum).totalPaise).toBe(Number.MAX_SAFE_INTEGER)
    expect(formatPaise(asPaise(Number.MAX_SAFE_INTEGER))).toBe('90071992547409.91')
    expect(purchaseAmounts({ ...body(), order_discount: '10.00' }).totalPaise).toBe(0)
  })
  it('retains exact one-paise arithmetic across 100 small lines and strips whitespace without changing value', () => {
    const values = purchaseCreateSchema.parse({ ...body(), notes: ' \n ', items: Array.from({ length: 100 }, () => ({ ...item, description: '  Original frame  ', quantity: 3, unit_price: '0.10', discount: '0.01' })), order_discount: '0.03' })
    expect(values.notes).toBeNull()
    expect(values.items[0].description).toBe('Original frame')
    const calculated = purchaseAmounts(values)
    expect(calculated).toMatchObject({ subtotalPaise: 3000, discountPaise: 103, totalPaise: 2897, taxPaise: 0 })
    expect(calculated.lineTotals.every(total => total === 29)).toBe(true)
    for (const text of ['0.01', '0.10', '0.29', '125.50']) expect(formatPaise(parseRupeesToPaise(text))).toBe(text)
  })
  it('adapts browser strings through the same server rules, including nested monetary errors', () => {
    const values = { ...body(), prescription_uuid: '', items: [{ ...item, quantity: '2', discount: '1.00' }] }
    expect(purchaseFormSchema.parse(values)).toMatchObject({ prescription_uuid: null, items: [{ quantity: 2 }], order_discount: '0' })
    for (const quantity of ['0', '01', '1.5', '1e2', '100001', '']) expect(purchaseFormSchema.safeParse({ ...values, items: [{ ...values.items[0], quantity }] }).success).toBe(false)
    expect(purchaseFormSchema.safeParse({ ...values, items: [{ ...values.items[0], discount: '20.01' }] }).success).toBe(false)
    expect(purchaseFormSchema.safeParse({ ...values, order_discount: '20.01' }).success).toBe(false)
  })
  it.each([{ page: '0' }, { page: '10001' }, { pageSize: '51' }, { page: '1e2' }, { dateFrom: '2026-02-30' }, { dateFrom: '2026-01-02', dateTo: '2026-01-01' }, { category: 'stock' }, { sort: 'sql' }])('rejects invalid history filter %j', query => {
    expect(purchaseListSchema.safeParse(query).success).toBe(false)
  })
})
