import type { PaymentSummary } from './payments.js'
import type { PurchaseTaxType } from './purchases.js'

export interface InvoiceShop { shop_name: string; address: string; contact_number: string; gstin: string | null; footer_text: string }
export interface InvoiceIdentity extends Omit<InvoiceShop, 'footer_text'> { updated_at: string }
export interface InvoiceItem {
  uuid: string; description: string; product_category: string; quantity: number
  unit_price_paise: number; discount_paise: number; line_total_paise: number
  taxable_paise: number; tax_rate_basis_points: number; tax_type: PurchaseTaxType; tax_paise: number; hsn_sac_code: string | null
}
export interface InvoiceSnapshot {
  version: 1
  shop: InvoiceShop
  customer: { name: string; phone: string }
  purchase: { uuid: string; purchase_date: string; prescription_uuid: string | null; currency_code: 'INR'; subtotal_paise: number; discount_paise: number; taxable_amount_paise: number; tax_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number; tax_type: PurchaseTaxType; total_paise: number }
  items: InvoiceItem[]
  payment_summary: PaymentSummary
  payment_methods: { payment_method: string; amount_paise: number }[]
  payment_count: number
}
export interface Invoice { uuid: string; purchase_uuid: string; customer_uuid: string; invoice_number: string; issued_at: string; snapshot: InvoiceSnapshot }
