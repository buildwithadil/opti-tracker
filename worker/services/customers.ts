import type { Customer, CustomerList } from '../../shared/customers.js'
import { formatIndianMobile, normalizeIndianMobile } from '../../shared/phone.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import type { CreateCustomerInput, CustomerListOptions, PatchCustomerInput } from '../validators/customers.js'

interface CustomerRow extends Customer { revision: number }
export interface CustomerActor { adminId: string; requestId: string }
type CustomerAction = 'create' | 'update' | 'archive' | 'restore'
const columns = 'uuid,name,phone,normalized_phone,created_at,updated_at,archived_at'
const snapshotJson = `json_object('uuid',uuid,'name',name,'phone',phone,'normalized_phone',normalized_phone,
  'created_at',created_at,'updated_at',updated_at,'archived_at',archived_at)`
const sortColumns: Record<CustomerListOptions['sort'], string> = {
  created_at: 'created_at', updated_at: 'updated_at', name: 'name COLLATE NOCASE', phone: 'normalized_phone',
}

function snapshot(row: CustomerRow): Customer {
  return {
    uuid: row.uuid, name: row.name, phone: row.phone, normalized_phone: row.normalized_phone,
    created_at: row.created_at, updated_at: row.updated_at, archived_at: row.archived_at,
  }
}

async function readCustomer(db: D1Database, uuid: string): Promise<CustomerRow> {
  const row = await db.prepare(`SELECT ${columns},revision FROM customers WHERE uuid = ?`).bind(uuid).first<CustomerRow>()
  if (!row) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'The customer was not found.')
  return row
}

export async function getCustomer(db: D1Database, uuid: string): Promise<Customer> {
  return snapshot(await readCustomer(db, uuid))
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/gu, '\\$&') }

export async function listCustomers(db: D1Database, query: CustomerListOptions): Promise<CustomerList> {
  const conditions: string[] = []
  const parameters: (string | number)[] = []
  if (query.status !== 'all') conditions.push(query.status === 'active' ? 'archived_at IS NULL' : 'archived_at IS NOT NULL')
  if (query.search) {
    const searchConditions = ["name LIKE ? ESCAPE '\\' COLLATE NOCASE"]
    parameters.push(`%${escapeLike(query.search)}%`)
    let canonical: string | null = null
    try { canonical = normalizeIndianMobile(query.search) } catch { /* A name or partial phone is not a complete mobile number. */ }
    if (canonical) {
      searchConditions.push('normalized_phone = ?')
      parameters.push(canonical)
    } else if (/^[0-9]+$/u.test(query.search)) {
      searchConditions.push("normalized_phone LIKE ? ESCAPE '\\'")
      parameters.push(`%${query.search}%`)
    }
    conditions.push(`(${searchConditions.join(' OR ')})`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const order = query.order === 'asc' ? 'ASC' : 'DESC'
  // The only interpolated identifiers/direction are literal allowlisted values.
  // Count and page share the same D1 transaction/snapshot, even during writes.
  const results = await runD1Batch(db, [
    db.prepare(`SELECT ${columns} FROM customers ${where}
      ORDER BY ${sortColumns[query.sort]} ${order},uuid ASC LIMIT ? OFFSET ?`)
      .bind(...parameters, query.pageSize, (query.page - 1) * query.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM customers ${where}`).bind(...parameters),
  ])
  const customers = results[0].results as Customer[]
  const { total } = results[1].results[0] as { total: number }
  return { customers, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } }
}

function rethrowWriteError(error: unknown): never {
  if (error instanceof Error && /UNIQUE constraint failed: customers\.normalized_phone|uq_customers_active_normalized_phone/u.test(error.message)) {
    const message = 'An active customer already uses this mobile number. Use a different number or open that customer.'
    throw new HttpError(409, 'CUSTOMER_PHONE_CONFLICT', message, [{ field: 'phone', message: 'This mobile number is already in use by an active customer.' }])
  }
  throw error
}

/** After the immediately preceding INSERT/guarded UPDATE, changes() prevents
 * an audit for a rejected stale revision, even when a competing write advanced
 * that row to exactly the revision we expected. The SELECT captures persisted
 * public fields (not internal revisions, credentials, session or IP data).
 */
function prepareAudit(db: D1Database, action: CustomerAction, before: Customer | null, uuid: string,
  revision: number, actor: CustomerActor, now: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,before_json,after_json,request_id,created_at)
    SELECT ?,?,?,'customer',uuid,?,${snapshotJson},?,? FROM customers
    WHERE uuid = ? AND revision = ? AND changes() = 1`)
    .bind(crypto.randomUUID(), actor.adminId, action, before ? JSON.stringify(before) : null, actor.requestId, now, uuid, revision)
}

export async function createCustomer(db: D1Database, input: CreateCustomerInput, actor: CustomerActor): Promise<Customer> {
  const uuid = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    const results = await runD1Batch<Customer>(db, [
      db.prepare(`INSERT INTO customers(uuid,name,phone,normalized_phone,created_at,updated_at,created_by_admin_id,updated_by_admin_id)
        VALUES (?,?,?,?,?,?,?,?)`)
        .bind(uuid, input.name, formatIndianMobile(input.phone), input.phone, now, now, actor.adminId, actor.adminId),
      prepareAudit(db, 'create', null, uuid, 0, actor, now),
      db.prepare(`SELECT ${columns} FROM customers WHERE uuid = ?`).bind(uuid),
    ])
    return results[2].results[0]
  } catch (error) { rethrowWriteError(error) }
}

async function mutateCustomer(db: D1Database, before: CustomerRow, input: PatchCustomerInput,
  action: Exclude<CustomerAction, 'create'>, actor: CustomerActor): Promise<Customer> {
  const now = new Date().toISOString()
  const archivedAt = action === 'archive' ? now : action === 'restore' ? null : before.archived_at
  const normalizedPhone = input.phone ?? before.normalized_phone
  const nextRevision = before.revision + 1
  try {
    const results = await runD1Batch<Customer>(db, [
      db.prepare(`UPDATE customers SET name = ?,phone = ?,normalized_phone = ?,updated_at = ?,updated_by_admin_id = ?,
        archived_at = ?,deleted_by_admin_id = CASE WHEN ? = 'archive' THEN ? WHEN ? = 'restore' THEN NULL ELSE deleted_by_admin_id END,
        revision = revision + 1 WHERE uuid = ? AND revision = ?`)
        .bind(input.name ?? before.name, formatIndianMobile(normalizedPhone), normalizedPhone, now, actor.adminId,
          archivedAt, action, actor.adminId, action, before.uuid, before.revision),
      prepareAudit(db, action, snapshot(before), before.uuid, nextRevision, actor, now),
      db.prepare(`SELECT ${columns} FROM customers WHERE uuid = ?`).bind(before.uuid),
    ])
    if (results[0].meta.changes !== 1) {
      throw new HttpError(409, 'CUSTOMER_CHANGED', 'This customer changed while you were saving. Reload the customer and try again.')
    }
    return results[2].results[0]
  } catch (error) { rethrowWriteError(error) }
}

export async function updateCustomer(db: D1Database, uuid: string, input: PatchCustomerInput, actor: CustomerActor): Promise<Customer> {
  return mutateCustomer(db, await readCustomer(db, uuid), input, 'update', actor)
}

export async function archiveCustomer(db: D1Database, uuid: string, actor: CustomerActor): Promise<Customer> {
  const before = await readCustomer(db, uuid)
  return before.archived_at !== null ? snapshot(before) : mutateCustomer(db, before, {}, 'archive', actor)
}

export async function restoreCustomer(db: D1Database, uuid: string, actor: CustomerActor): Promise<Customer> {
  const before = await readCustomer(db, uuid)
  return before.archived_at !== null ? mutateCustomer(db, before, {}, 'restore', actor) : snapshot(before)
}
