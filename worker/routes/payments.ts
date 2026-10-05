import type { BlazeApp } from 'blazefw'
import type { Env } from '../types.js'
import { requireAdmin } from '../lib/auth.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { readJson } from '../lib/request.js'
import { createPayment, getPayment, listPayments } from '../services/payments.js'
import { customerCreditSummary } from '../services/payment-balances.js'
import { parsePaymentListQuery, paymentCreateSchema, paymentPathSchema, purchaseCustomerPathSchema, purchaseItemPathSchema } from '../validators/payments.js'
import type { RegisterRoute } from './auth.js'

export function registerPayments(app: BlazeApp<Env>, route: RegisterRoute): void {
  app.get('/api/customers/:customerUuid/credit-summary', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid } = purchaseCustomerPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await customerCreditSummary(req.env.DB, customerUuid), { meta: { requestId: req.id } }))
  }))
  app.get('/api/customers/:customerUuid/purchases/:purchaseUuid/payments', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid, purchaseUuid } = purchaseItemPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await listPayments(req.env.DB, customerUuid, purchaseUuid, parsePaymentListQuery(new URL(req.raw.url))), { meta: { requestId: req.id } }))
  }))
  app.post('/api/customers/:customerUuid/purchases/:purchaseUuid/payments', route(async (req, res) => {
    const actor = { adminId: requireAdmin(req).id, requestId: req.id }
    const { customerUuid, purchaseUuid } = purchaseItemPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await createPayment(req.env.DB, customerUuid, purchaseUuid, paymentCreateSchema.parse(await readJson(req.raw)), actor), { status: 201, message: 'Payment recorded.', meta: { requestId: req.id } }))
  }))
  app.get('/api/customers/:customerUuid/purchases/:purchaseUuid/payments/:paymentUuid', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid, purchaseUuid, paymentUuid } = paymentPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await getPayment(req.env.DB, customerUuid, purchaseUuid, paymentUuid), { meta: { requestId: req.id } }))
  }))
}
