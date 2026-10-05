import type { QueryClient } from '@tanstack/react-query'
import type { CustomerListQuery } from '../../shared/customers'
import type { ReceiptQuery, SalesList, ShopCustomerList, ShopPaymentList, ShopQuery } from '../../shared/shop'
import { apiRequest } from './api'

const params = (query: object) => { const values=new URLSearchParams(); Object.entries(query).forEach(([key,value]) => { if (value !== undefined && value !== '') values.set(key,String(value)) }); return values }
export const shopApi = {
  sales: (query: ShopQuery = {},signal?: AbortSignal) => apiRequest<SalesList>(`/api/sales?${params(query)}`,{ signal }),
  customers: (query: CustomerListQuery,signal?: AbortSignal) => apiRequest<ShopCustomerList>(`/api/shop/customers?${params(query)}`,{ signal }),
  payments: (query: ReceiptQuery = {},signal?: AbortSignal) => apiRequest<ShopPaymentList>(`/api/shop/payments?${params(query)}`,{ signal }),
}
export async function refreshShop(client: QueryClient) {
  await Promise.all(['shop','reports','customers','purchases','payments'].map(key => client.invalidateQueries({ queryKey: [key] })))
}
