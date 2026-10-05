import type { BlazeApp } from 'blazefw'
import type { Env } from '../types.js'
import { requireAdmin } from '../lib/auth.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { readJson } from '../lib/request.js'
import { invoiceGenerateSchema, invoiceIdentitySchema } from '../../shared/invoiceValidation.js'
import { purchaseItemPathSchema } from '../../shared/purchaseValidation.js'
import { getInvoice, generateInvoice } from '../services/invoices.js'
import { getInvoiceIdentity, updateInvoiceIdentity } from '../services/invoice-identity.js'
import type { RegisterRoute } from './auth.js'

export function registerInvoices(app: BlazeApp<Env>, route: RegisterRoute): void {
  app.get('/api/shop/invoice-identity', route(async (req, res) => {
    requireAdmin(req)
    sendResponse(res, apiSuccess(await getInvoiceIdentity(req.env.DB), { meta: { requestId: req.id } }))
  }))
  app.patch('/api/shop/invoice-identity', route(async (req, res) => {
    const actor = { adminId: requireAdmin(req).id, requestId: req.id }
    sendResponse(res, apiSuccess(await updateInvoiceIdentity(req.env.DB, invoiceIdentitySchema.parse(await readJson(req.raw)), actor), { message: 'Invoice business information saved.', meta: { requestId: req.id } }))
  }))
  app.get('/api/customers/:customerUuid/purchases/:purchaseUuid/invoice', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid, purchaseUuid } = purchaseItemPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await getInvoice(req.env.DB, customerUuid, purchaseUuid), { meta: { requestId: req.id } }))
  }))
  app.post('/api/customers/:customerUuid/purchases/:purchaseUuid/invoice', route(async (req, res) => {
    const actor = { adminId: requireAdmin(req).id, requestId: req.id }
    const { customerUuid, purchaseUuid } = purchaseItemPathSchema.parse(req.params)
    const result = await generateInvoice(req.env.DB, customerUuid, purchaseUuid, invoiceGenerateSchema.parse(await readJson(req.raw)), actor)
    sendResponse(res, apiSuccess(result.invoice, { status: result.created ? 201 : 200, message: result.created ? 'Invoice generated.' : 'Existing invoice retrieved.', meta: { requestId: req.id } }))
  }))
}
