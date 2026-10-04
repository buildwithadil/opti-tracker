import type { Prescription, PrescriptionHistory, PrescriptionInput, PrescriptionList, PrescriptionRevisionInput } from '../../shared/prescriptions.js'
import { prescriptionCreateSchema, prescriptionRevisionSchema, type PrescriptionCreateValues } from '../../shared/prescriptionValidation.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import type { PrescriptionListOptions } from '../validators/prescriptions.js'

export interface PrescriptionActor { adminId: string; requestId: string }
interface CustomerState { uuid: string; archived_at: string | null }
const columns = `p.id AS uuid,p.customer_id AS customer_uuid,p.prescription_type,p.prescribed_on,p.expires_on,
  p.prescriber_name,p.notes,p.right_sphere,p.right_cylinder,p.right_axis,p.right_addition,
  p.left_sphere,p.left_cylinder,p.left_axis,p.left_addition,p.pupillary_distance AS distance_pd,
  p.near_pd,p.right_pd,p.left_pd,p.root_id AS root_uuid,p.revision_number,p.supersedes_id AS supersedes_uuid,
  successor.id AS superseded_by_uuid,successor.created_at AS superseded_at,
  CASE WHEN p.status = 'archived' OR p.deleted_at IS NOT NULL THEN 'archived'
    WHEN successor.id IS NOT NULL THEN 'superseded' ELSE 'current' END AS status,
  p.revision_reason,p.created_at,p.updated_at`
const from = `FROM prescriptions AS p LEFT JOIN prescriptions AS successor
  ON successor.supersedes_id = p.id AND successor.customer_id = p.customer_id`
const insertColumns = `id,customer_id,prescription_type,prescribed_on,expires_on,prescriber_name,notes,
  right_sphere,right_cylinder,right_axis,right_addition,left_sphere,left_cylinder,left_axis,left_addition,
  pupillary_distance,near_pd,right_pd,left_pd,root_id,supersedes_id,revision_number,revision_reason,
  created_at,updated_at,created_by_admin_id,updated_by_admin_id`

async function readCustomer(db: D1Database, customerUuid: string): Promise<CustomerState> {
  const customer = await db.prepare('SELECT uuid,archived_at FROM customers WHERE uuid = ?').bind(customerUuid).first<CustomerState>()
  if (!customer) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'The customer was not found.')
  return customer
}
function assertCustomerActive(customer: CustomerState): void {
  if (customer.archived_at !== null) throw new HttpError(409, 'CUSTOMER_ARCHIVED', 'Restore the customer before adding or revising a prescription.')
}
function notCurrent(): HttpError {
  return new HttpError(409, 'PRESCRIPTION_NOT_CURRENT', 'Only the current prescription can be revised. Open its latest version and try again.')
}
async function readPrescription(db: D1Database, customerUuid: string, prescriptionUuid: string): Promise<Prescription> {
  const prescription = await db.prepare(`SELECT ${columns} ${from} WHERE p.customer_id = ? AND p.id = ?`)
    .bind(customerUuid, prescriptionUuid).first<Prescription>()
  if (!prescription) throw new HttpError(404, 'PRESCRIPTION_NOT_FOUND', 'The prescription was not found for this customer.')
  return prescription
}

export async function getPrescription(db: D1Database, customerUuid: string, prescriptionUuid: string): Promise<Prescription> {
  await readCustomer(db, customerUuid)
  return readPrescription(db, customerUuid, prescriptionUuid)
}
function pageResult(prescriptions: Prescription[], total: number, query: PrescriptionListOptions): PrescriptionList {
  return { prescriptions, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } }
}
export async function listPrescriptions(db: D1Database, customerUuid: string, query: PrescriptionListOptions): Promise<PrescriptionList> {
  await readCustomer(db, customerUuid)
  const results = await runD1Batch(db, [
    db.prepare(`SELECT ${columns} ${from} WHERE p.customer_id = ?
      ORDER BY p.prescribed_on DESC,p.created_at DESC,p.id ASC LIMIT ? OFFSET ?`)
      .bind(customerUuid, query.pageSize, (query.page - 1) * query.pageSize),
    db.prepare('SELECT COUNT(*) AS total FROM prescriptions WHERE customer_id = ?').bind(customerUuid),
  ])
  const { total } = results[1].results[0] as { total: number }
  return pageResult(results[0].results as Prescription[], total, query)
}
export async function getPrescriptionHistory(db: D1Database, customerUuid: string, prescriptionUuid: string,
  query: PrescriptionListOptions): Promise<PrescriptionHistory> {
  await readCustomer(db, customerUuid)
  const prescription = await readPrescription(db, customerUuid, prescriptionUuid)
  // Both identifiers remain bound in the history page/count, not just the
  // preliminary detail lookup. Archived/deleted legacy versions stay readable.
  const where = `p.customer_id = ? AND p.root_id = (
    SELECT root_id FROM prescriptions WHERE customer_id = ? AND id = ?)`
  const results = await runD1Batch(db, [
    db.prepare(`SELECT ${columns} ${from} WHERE ${where} ORDER BY p.revision_number DESC,p.id ASC LIMIT ? OFFSET ?`)
      .bind(customerUuid, customerUuid, prescriptionUuid, query.pageSize, (query.page - 1) * query.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM prescriptions AS p WHERE ${where}`)
      .bind(customerUuid, customerUuid, prescriptionUuid),
  ])
  const { total } = results[1].results[0] as { total: number }
  return { ...pageResult(results[0].results as Prescription[], total, query), root_uuid: prescription.root_uuid }
}

/** Audits carry identifiers/version/date/status only. The immutable clinical
 * row is the source of truth; never duplicate powers, PD, notes or prescriber.
 */
function metadata(row: Prescription) {
  return {
    uuid: row.uuid, customer_uuid: row.customer_uuid, prescription_type: row.prescription_type,
    root_uuid: row.root_uuid, revision_number: row.revision_number, supersedes_uuid: row.supersedes_uuid,
    superseded_by_uuid: row.superseded_by_uuid, superseded_at: row.superseded_at,
    prescribed_on: row.prescribed_on, expires_on: row.expires_on, status: row.status,
    created_at: row.created_at, updated_at: row.updated_at,
  }
}
const metadataJson = `json_object('uuid',p.id,'customer_uuid',p.customer_id,'prescription_type',p.prescription_type,
  'root_uuid',p.root_id,'revision_number',p.revision_number,'supersedes_uuid',p.supersedes_id,
  'superseded_by_uuid',successor.id,'superseded_at',successor.created_at,
  'prescribed_on',p.prescribed_on,'expires_on',p.expires_on,
  'status',CASE WHEN p.status = 'archived' OR p.deleted_at IS NOT NULL THEN 'archived'
    WHEN successor.id IS NOT NULL THEN 'superseded' ELSE 'current' END,
  'created_at',p.created_at,'updated_at',p.updated_at)`

function prepareAudit(db: D1Database, action: 'create' | 'supersede' | 'revise', before: Prescription | null,
  customerUuid: string, prescriptionUuid: string, actor: PrescriptionActor, now: string): D1PreparedStatement {
  // Each successful insert writes exactly one row. Following the insert (or
  // the first audit), changes() = 1 ensures a rejected conditional insert can
  // never leave a failed-attempt audit, even under same-parent revision races.
  return db.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,before_json,after_json,request_id,created_at)
    SELECT ?,?,?,'prescription',p.id,?,${metadataJson},?,? ${from}
    WHERE p.customer_id = ? AND p.id = ? AND changes() = 1`)
    .bind(crypto.randomUUID(), actor.adminId, action, before ? JSON.stringify(metadata(before)) : null,
      actor.requestId, now, customerUuid, prescriptionUuid)
}
function values(uuid: string, customerUuid: string, input: PrescriptionCreateValues, rootUuid: string,
  parentUuid: string | null, revision: number, reason: string | null, actor: PrescriptionActor, now: string) {
  return [uuid, customerUuid, 'spectacle', input.prescribed_on, input.expires_on, input.prescriber_name, input.notes,
    input.right_sphere, input.right_cylinder, input.right_axis, input.right_addition,
    input.left_sphere, input.left_cylinder, input.left_axis, input.left_addition,
    input.distance_pd, input.near_pd, input.right_pd, input.left_pd,
    rootUuid, parentUuid, revision, reason, now, now, actor.adminId, actor.adminId]
}
const placeholders = Array.from({ length: 27 }, () => '?').join(',')
function rethrowRevisionError(error: unknown): never {
  if (error instanceof Error && /UNIQUE constraint failed: prescriptions\.(?:supersedes_id|root_id)|uq_prescriptions_(?:successor|root_revision)|invalid prescription lineage/u.test(error.message)) {
    throw notCurrent()
  }
  throw error
}

export async function createPrescription(db: D1Database, customerUuid: string, input: PrescriptionInput,
  actor: PrescriptionActor): Promise<Prescription> {
  assertCustomerActive(await readCustomer(db, customerUuid))
  const normalized = prescriptionCreateSchema.parse(input)
  const uuid = crypto.randomUUID()
  const now = new Date().toISOString()
  const results = await runD1Batch<Prescription>(db, [
    // The customer guard is evaluated within the same transaction as the
    // clinical row, audit and persisted response, not just in the pre-read.
    db.prepare(`INSERT INTO prescriptions(${insertColumns}) SELECT ${placeholders}
      FROM customers WHERE uuid = ? AND archived_at IS NULL`)
      .bind(...values(uuid, customerUuid, normalized, uuid, null, 1, null, actor, now), customerUuid),
    prepareAudit(db, 'create', null, customerUuid, uuid, actor, now),
    db.prepare(`SELECT ${columns} ${from} WHERE p.customer_id = ? AND p.id = ?`).bind(customerUuid, uuid),
  ])
  if (results[0].meta.changes !== 1) {
    await readCustomer(db, customerUuid)
    throw new HttpError(409, 'CUSTOMER_ARCHIVED', 'Restore the customer before adding a prescription.')
  }
  return results[2].results[0]
}

export async function revisePrescription(db: D1Database, customerUuid: string, prescriptionUuid: string,
  input: PrescriptionRevisionInput, actor: PrescriptionActor): Promise<Prescription> {
  const customer = await readCustomer(db, customerUuid)
  const before = await readPrescription(db, customerUuid, prescriptionUuid)
  assertCustomerActive(customer)
  if (before.status !== 'current') throw notCurrent()
  if (before.prescription_type !== 'spectacle') {
    throw new HttpError(409, 'PRESCRIPTION_UNSUPPORTED_TYPE', 'Only spectacle prescriptions can be revised with this form.')
  }
  const { revision_reason, ...patch } = prescriptionRevisionSchema.parse(input)
  const normalized = prescriptionCreateSchema.parse({
    prescribed_on: before.prescribed_on, expires_on: before.expires_on, prescriber_name: before.prescriber_name, notes: before.notes,
    right_sphere: before.right_sphere, right_cylinder: before.right_cylinder, right_axis: before.right_axis, right_addition: before.right_addition,
    left_sphere: before.left_sphere, left_cylinder: before.left_cylinder, left_axis: before.left_axis, left_addition: before.left_addition,
    distance_pd: before.distance_pd, near_pd: before.near_pd, right_pd: before.right_pd, left_pd: before.left_pd,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  })
  const uuid = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    const results = await runD1Batch<Prescription>(db, [
      db.prepare(`INSERT INTO prescriptions(${insertColumns}) SELECT ${placeholders}
        FROM prescriptions AS parent JOIN customers AS customer ON customer.uuid = parent.customer_id
        WHERE parent.customer_id = ? AND parent.id = ? AND parent.root_id = ? AND parent.revision_number = ?
          AND parent.status = 'active' AND parent.deleted_at IS NULL AND customer.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM prescriptions AS child WHERE child.supersedes_id = parent.id)`)
        .bind(...values(uuid, customerUuid, normalized, before.root_uuid, before.uuid, before.revision_number + 1, revision_reason, actor, now),
          customerUuid, prescriptionUuid, before.root_uuid, before.revision_number),
      prepareAudit(db, 'supersede', before, customerUuid, prescriptionUuid, actor, now),
      prepareAudit(db, 'revise', null, customerUuid, uuid, actor, now),
      db.prepare(`SELECT ${columns} ${from} WHERE p.customer_id = ? AND p.id = ?`).bind(customerUuid, uuid),
    ])
    if (results[0].meta.changes !== 1) {
      assertCustomerActive(await readCustomer(db, customerUuid))
      throw notCurrent()
    }
    return results[3].results[0]
  } catch (error) { rethrowRevisionError(error) }
}
