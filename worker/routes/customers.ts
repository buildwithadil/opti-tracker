import type { BlazeApp } from 'blazefw'
import type { Env } from '../types.js'
import type { RequestWithAuth } from '../lib/auth.js'
import { requireAdmin } from '../lib/auth.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { readJson } from '../lib/request.js'
import { archiveCustomer, createCustomer, getCustomer, listCustomers, restoreCustomer, updateCustomer, type CustomerActor } from '../services/customers.js'
import { createCustomerSchema, customerPathSchema, parseCustomerListQuery, patchCustomerSchema } from '../validators/customers.js'
import type { RegisterRoute } from './auth.js'

function actor(req: RequestWithAuth): CustomerActor {
  return { adminId: requireAdmin(req).id, requestId: req.id }
}
function customerUuid(req: RequestWithAuth): string { return customerPathSchema.parse(req.params).uuid }

/** Registered behind the existing centralized administrator/Origin/CSRF
 * boundary. DELETE archives the record; it never permanently deletes it.
 */
export function registerCustomers(app: BlazeApp<Env>, route: RegisterRoute): void {
  app.get('/api/customers', route(async (req, res) => {
    requireAdmin(req)
    const query = parseCustomerListQuery(new URL(req.raw.url))
    sendResponse(res, apiSuccess(await listCustomers(req.env.DB, query), { meta: { requestId: req.id } }))
  }))
  app.post('/api/customers', route(async (req, res) => {
    const administrator = actor(req)
    const input = createCustomerSchema.parse(await readJson(req.raw))
    sendResponse(res, apiSuccess(await createCustomer(req.env.DB, input, administrator), {
      status: 201, message: 'Customer created.', meta: { requestId: req.id },
    }))
  }))
  app.get('/api/customers/:uuid', route(async (req, res) => {
    requireAdmin(req)
    sendResponse(res, apiSuccess(await getCustomer(req.env.DB, customerUuid(req)), { meta: { requestId: req.id } }))
  }))
  app.patch('/api/customers/:uuid', route(async (req, res) => {
    const administrator = actor(req)
    const uuid = customerUuid(req)
    const input = patchCustomerSchema.parse(await readJson(req.raw))
    sendResponse(res, apiSuccess(await updateCustomer(req.env.DB, uuid, input, administrator), {
      message: 'Customer updated.', meta: { requestId: req.id },
    }))
  }))
  app.delete('/api/customers/:uuid', route(async (req, res) => {
    const administrator = actor(req)
    sendResponse(res, apiSuccess(await archiveCustomer(req.env.DB, customerUuid(req), administrator), {
      message: 'Customer archived.', meta: { requestId: req.id },
    }))
  }))
  app.post('/api/customers/:uuid/restore', route(async (req, res) => {
    const administrator = actor(req)
    sendResponse(res, apiSuccess(await restoreCustomer(req.env.DB, customerUuid(req), administrator), {
      message: 'Customer restored.', meta: { requestId: req.id },
    }))
  }))
}
