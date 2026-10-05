import type { BlazeApp } from 'blazefw'
import type { Env } from '../types.js'
import type { RequestWithAuth } from '../lib/auth.js'
import { requireAdmin } from '../lib/auth.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { readJson } from '../lib/request.js'
import { createPurchase, getPurchase, listPurchases, type PurchaseActor } from '../services/purchases.js'
import { parsePurchaseListQuery, purchaseCreateSchema, purchaseCustomerPathSchema, purchaseItemPathSchema } from '../validators/purchases.js'
import type { RegisterRoute } from './auth.js'

function actor(req: RequestWithAuth): PurchaseActor {
  return { adminId: requireAdmin(req).id, requestId: req.id }
}

/** Customer-scoped purchase history and append-only creation/detail routes.
 * The centralized boundary supplies auth, exact Origin and CSRF for POST. */
export function registerPurchases(app: BlazeApp<Env>, route: RegisterRoute): void {
  app.get('/api/customers/:customerUuid/purchases', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid } = purchaseCustomerPathSchema.parse(req.params)
    const query = parsePurchaseListQuery(new URL(req.raw.url))
    sendResponse(res, apiSuccess(await listPurchases(req.env.DB, customerUuid, query), { meta: { requestId: req.id } }))
  }))
  app.post('/api/customers/:customerUuid/purchases', route(async (req, res) => {
    const administrator = actor(req)
    const { customerUuid } = purchaseCustomerPathSchema.parse(req.params)
    const input = purchaseCreateSchema.parse(await readJson(req.raw))
    sendResponse(res, apiSuccess(await createPurchase(req.env.DB, customerUuid, input, administrator), {
      status: 201, message: 'Purchase created.', meta: { requestId: req.id },
    }))
  }))
  app.get('/api/customers/:customerUuid/purchases/:purchaseUuid', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid, purchaseUuid } = purchaseItemPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await getPurchase(req.env.DB, customerUuid, purchaseUuid), { meta: { requestId: req.id } }))
  }))
}
