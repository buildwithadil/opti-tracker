import { paymentListSchema } from '../../shared/paymentValidation.js'
import { readQueryParameters } from '../lib/query.js'
export { paymentCreateSchema, paymentPathSchema, paymentListSchema } from '../../shared/paymentValidation.js'
export { purchaseCustomerPathSchema, purchaseItemPathSchema } from '../../shared/purchaseValidation.js'
export const parsePaymentListQuery = (url: URL) => paymentListSchema.parse(readQueryParameters(url, 'payment'))
