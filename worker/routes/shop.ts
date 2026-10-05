import type { BlazeApp } from 'blazefw'
import type { Env } from '../types.js'
import type { RegisterRoute } from './auth.js'
import { requireAdmin } from '../lib/auth.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { readQueryParameters } from '../lib/query.js'
import { salesQuerySchema, receiptsQuerySchema } from '../../shared/shop.js'
import { parseCustomerListQuery } from '../validators/customers.js'
import { listSales, listShopCustomers, listShopPayments } from '../services/shop.js'

/** Additive owner-only read views; all financial writes retain existing APIs. */
export function registerShop(app: BlazeApp<Env>, route: RegisterRoute) {
  app.get('/api/sales',route(async (req,res) => { requireAdmin(req); sendResponse(res,apiSuccess(await listSales(req.env.DB,salesQuerySchema.parse(readQueryParameters(new URL(req.raw.url),'sales'))),{ meta: { requestId: req.id } })) }))
  app.get('/api/shop/customers',route(async (req,res) => { requireAdmin(req); sendResponse(res,apiSuccess(await listShopCustomers(req.env.DB,parseCustomerListQuery(new URL(req.raw.url))),{ meta: { requestId: req.id } })) }))
  app.get('/api/shop/payments',route(async (req,res) => { requireAdmin(req); sendResponse(res,apiSuccess(await listShopPayments(req.env.DB,receiptsQuerySchema.parse(readQueryParameters(new URL(req.raw.url),'payments'))),{ meta: { requestId: req.id } })) }))
}
