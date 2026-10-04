import type { BlazeApp } from 'blazefw'
import type { Env } from '../types.js'
import type { RequestWithAuth } from '../lib/auth.js'
import { requireAdmin } from '../lib/auth.js'
import { apiSuccess, sendResponse } from '../lib/api.js'
import { readJson } from '../lib/request.js'
import { prescriptionCreateSchema, prescriptionRevisionSchema } from '../../shared/prescriptionValidation.js'
import { createPrescription, getPrescription, getPrescriptionHistory, listPrescriptions, revisePrescription, type PrescriptionActor } from '../services/prescriptions.js'
import { parsePrescriptionListQuery, prescriptionCustomerPathSchema, prescriptionItemPathSchema } from '../validators/prescriptions.js'
import type { RegisterRoute } from './auth.js'

function actor(req: RequestWithAuth): PrescriptionActor {
  return { adminId: requireAdmin(req).id, requestId: req.id }
}

/** All routes share the unchanged centralized auth/Origin/CSRF boundary.
 * Clinical versions are append-only: PATCH inserts a replacement; no DELETE.
 */
export function registerPrescriptions(app: BlazeApp<Env>, route: RegisterRoute): void {
  app.get('/api/customers/:customerUuid/prescriptions', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid } = prescriptionCustomerPathSchema.parse(req.params)
    const query = parsePrescriptionListQuery(new URL(req.raw.url))
    sendResponse(res, apiSuccess(await listPrescriptions(req.env.DB, customerUuid, query), { meta: { requestId: req.id } }))
  }))
  app.post('/api/customers/:customerUuid/prescriptions', route(async (req, res) => {
    const administrator = actor(req)
    const { customerUuid } = prescriptionCustomerPathSchema.parse(req.params)
    const input = prescriptionCreateSchema.parse(await readJson(req.raw))
    sendResponse(res, apiSuccess(await createPrescription(req.env.DB, customerUuid, input, administrator), {
      status: 201, message: 'Prescription created.', meta: { requestId: req.id },
    }))
  }))
  app.get('/api/customers/:customerUuid/prescriptions/:prescriptionUuid', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid, prescriptionUuid } = prescriptionItemPathSchema.parse(req.params)
    sendResponse(res, apiSuccess(await getPrescription(req.env.DB, customerUuid, prescriptionUuid), { meta: { requestId: req.id } }))
  }))
  app.patch('/api/customers/:customerUuid/prescriptions/:prescriptionUuid', route(async (req, res) => {
    const administrator = actor(req)
    const { customerUuid, prescriptionUuid } = prescriptionItemPathSchema.parse(req.params)
    const input = prescriptionRevisionSchema.parse(await readJson(req.raw))
    sendResponse(res, apiSuccess(await revisePrescription(req.env.DB, customerUuid, prescriptionUuid, input, administrator), {
      status: 201, message: 'Prescription revised.', meta: { requestId: req.id },
    }))
  }))
  app.get('/api/customers/:customerUuid/prescriptions/:prescriptionUuid/history', route(async (req, res) => {
    requireAdmin(req)
    const { customerUuid, prescriptionUuid } = prescriptionItemPathSchema.parse(req.params)
    const query = parsePrescriptionListQuery(new URL(req.raw.url))
    sendResponse(res, apiSuccess(await getPrescriptionHistory(req.env.DB, customerUuid, prescriptionUuid, query), { meta: { requestId: req.id } }))
  }))
}
