/** Customer API contract; no business history or derived financial metrics. */
export interface Customer {
  uuid: string
  name: string
  phone: string
  normalized_phone: string
  created_at: string
  updated_at: string
  archived_at: string | null
}

export interface CustomerPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface CustomerList {
  customers: Customer[]
  pagination: CustomerPagination
}

export interface CustomerInput {
  name: string
  phone: string
}

export interface CustomerListQuery {
  search?: string
  status?: 'active' | 'archived' | 'all'
  page?: number
  pageSize?: number
  sort?: 'created_at' | 'updated_at' | 'name' | 'phone'
  order?: 'asc' | 'desc'
}
