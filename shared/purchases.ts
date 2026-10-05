/** Public purchase contracts. Monetary values crossing the API are integer
 * paise; create input uses decimal rupee strings and never accepts totals. */
import type { PaymentSummary } from './payments.js'
export type PurchaseStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void' | 'refunded'
export type PurchaseTaxType = 'none' | 'cgst_sgst' | 'igst'
export type PurchaseLineType = 'product' | 'service' | 'adjustment'

export const purchaseCategories = ['spectacle_frames', 'prescription_lenses', 'contact_lenses', 'sunglasses', 'reading_glasses', 'optical_accessories', 'other'] as const
export type PurchaseCategory = typeof purchaseCategories[number]
export const purchaseCategoryLabels: Record<PurchaseCategory, string> = {
  spectacle_frames: 'Spectacle frames', prescription_lenses: 'Prescription lenses',
  contact_lenses: 'Contact lenses', sunglasses: 'Sunglasses', reading_glasses: 'Reading glasses',
  optical_accessories: 'Optical accessories', other: 'Other products',
}

export interface PurchaseItemSnapshot {
  uuid: string
  purchase_uuid: string
  description: string
  sku: string | null
  line_type: PurchaseLineType
  product_category: string
  hsn_sac_code: string | null
  quantity: number
  unit_price_paise: number
  discount_paise: number
  taxable_paise: number
  tax_rate_basis_points: number
  tax_type: PurchaseTaxType
  tax_paise: number
  line_total_paise: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface Purchase extends PaymentSummary {
  uuid: string
  customer_uuid: string
  prescription_uuid: string | null
  purchase_date: string
  status: PurchaseStatus
  currency_code: 'INR'
  subtotal_paise: number
  discount_paise: number
  taxable_amount_paise: number
  tax_paise: number
  cgst_paise: number
  sgst_paise: number
  igst_paise: number
  tax_type: PurchaseTaxType
  total_paise: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseDetail extends Purchase {
  items: PurchaseItemSnapshot[]
}

export interface PurchaseListQuery {
  page?: number
  pageSize?: number
  dateFrom?: string
  dateTo?: string
  category?: PurchaseCategory
}

export interface PurchaseList {
  purchases: Purchase[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}
