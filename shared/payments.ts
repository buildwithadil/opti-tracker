export const paymentMethods = ['cash', 'upi', 'card'] as const
export type PaymentMethod = typeof paymentMethods[number]
export const paymentMethodLabels: Record<PaymentMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card' }
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid'
export const paymentStatusLabels: Record<PaymentStatus, string> = { unpaid: 'Unpaid', partially_paid: 'Partially paid', paid: 'Paid' }
export interface PaymentSummary {
  total_paise: number
  amount_paid_paise: number
  outstanding_paise: number
  payment_status: PaymentStatus
}
export interface Payment {
  uuid: string
  purchase_uuid: string
  customer_uuid: string
  amount_paise: number
  // Preserve readable legacy method/status text; new input is strictly controlled.
  payment_method: string
  status: string
  received_at: string
  reference: string | null
  notes: string | null
  created_at: string
}
export interface PaymentCreated { payment: Payment; purchase_summary: PaymentSummary }
export interface PaymentList extends PaymentCreatedSummary {
  payments: Payment[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}
interface PaymentCreatedSummary { purchase_summary: PaymentSummary }
export interface PaymentListQuery { page?: number; pageSize?: number }
export interface CustomerCreditSummary { customer_uuid: string; outstanding_paise: number }
