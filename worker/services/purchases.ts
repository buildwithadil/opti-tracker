import type { Purchase, PurchaseDetail, PurchaseItemSnapshot, PurchaseList } from '../../shared/purchases.js'
import { purchaseAmounts, purchaseCreateSchema, type PurchaseCreateInput } from '../../shared/purchaseValidation.js'
import { parseRupeesToPaise } from '../lib/money.js'
import { runD1Batch } from '../lib/db.js'
import { HttpError } from '../lib/errors.js'
import type { PurchaseListOptions } from '../validators/purchases.js'

export interface PurchaseActor { adminId: string; requestId: string }
interface CustomerState { uuid: string; archived_at: string | null }

const purchaseColumns = `p.id AS uuid,p.customer_id AS customer_uuid,
  p.prescription_id AS prescription_uuid,COALESCE(p.purchase_date,substr(p.created_at,1,10)) AS purchase_date,
  p.status,p.currency_code,p.subtotal_paise,p.discount_paise,p.taxable_amount_paise,
  p.tax_paise,p.cgst_paise,p.sgst_paise,p.igst_paise,p.tax_type,p.total_paise,p.notes,p.created_at,p.updated_at`
const itemColumns = `i.id AS uuid,i.purchase_id AS purchase_uuid,i.description,i.sku,i.line_type,
  i.product_category,i.hsn_sac_code,i.quantity,i.unit_price_paise,i.discount_paise,
  i.taxable_paise,i.tax_rate_basis_points,i.tax_type,i.tax_paise,i.line_total_paise,
  i.sort_order,i.created_at,i.updated_at`

async function readCustomer(db: D1Database, customerUuid: string): Promise<CustomerState> {
  const customer = await db.prepare('SELECT uuid,archived_at FROM customers WHERE uuid = ?').bind(customerUuid).first<CustomerState>()
  if (!customer) throw new HttpError(404, 'CUSTOMER_NOT_FOUND', 'The customer was not found.')
  return customer
}

function assertCustomerActive(customer: CustomerState): void {
  if (customer.archived_at !== null) throw new HttpError(409, 'CUSTOMER_ARCHIVED', 'Restore the customer before adding a purchase.')
}

async function assertPrescription(db: D1Database, customerUuid: string, prescriptionUuid: string | null): Promise<void> {
  if (prescriptionUuid === null) return
  const prescription = await db.prepare('SELECT id FROM prescriptions WHERE id = ? AND customer_id = ?')
    .bind(prescriptionUuid, customerUuid).first<{ id: string }>()
  if (!prescription) throw new HttpError(404, 'PRESCRIPTION_NOT_FOUND', 'The prescription was not found for this customer.')
}

function preparePurchase(input: PurchaseCreateInput) {
  const values = purchaseCreateSchema.parse(input)
  const totals = purchaseAmounts(values)
  const items = values.items.map((item, sortOrder) => ({
    id: crypto.randomUUID(), description: item.description, productCategory: item.product_category,
    quantity: item.quantity, unitPricePaise: parseRupeesToPaise(item.unit_price),
    discountPaise: parseRupeesToPaise(item.discount), lineTotalPaise: totals.lineTotals[sortOrder], sortOrder,
  }))
  return { values, items, ...totals }
}

function metadataJson(alias = 'p'): string {
  return `json_object('uuid',${alias}.id,'customer_uuid',${alias}.customer_id,
    'prescription_uuid',${alias}.prescription_id,'purchase_date',COALESCE(${alias}.purchase_date,substr(${alias}.created_at,1,10)),
    'status',${alias}.status,'subtotal_paise',${alias}.subtotal_paise,'discount_paise',${alias}.discount_paise,
    'tax_paise',${alias}.tax_paise,'total_paise',${alias}.total_paise,
    'item_count',(SELECT COUNT(*) FROM purchase_items AS i WHERE i.purchase_id = ${alias}.id),
    'items',json((SELECT json_group_array(json_object('uuid',i.id,'description',i.description,
      'product_category',i.product_category,'quantity',i.quantity,'unit_price_paise',i.unit_price_paise,
      'discount_paise',i.discount_paise,'line_total_paise',i.line_total_paise,'sort_order',i.sort_order))
      FROM (SELECT * FROM purchase_items WHERE purchase_id = ${alias}.id ORDER BY sort_order,id) AS i)))`
}

function prepareAudit(db: D1Database, customerUuid: string, purchaseUuid: string, auditUuid: string, actor: PurchaseActor, now: string): D1PreparedStatement {
  return db.prepare(`INSERT INTO audit_logs(id,actor_admin_user_id,action,entity_type,entity_id,before_json,after_json,request_id,created_at)
    SELECT ?,?, 'create', 'purchase', p.id, NULL, ${metadataJson()}, ?, ?
    FROM purchases AS p WHERE p.id = ? AND p.customer_id = ?`)
    .bind(auditUuid, actor.adminId, actor.requestId, now, purchaseUuid, customerUuid)
}

function publicPurchase(row: Purchase): Purchase { return row }
function pageResult(purchases: Purchase[], total: number, query: PurchaseListOptions): PurchaseList {
  return { purchases, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } }
}

export async function listPurchases(db: D1Database, customerUuid: string, query: PurchaseListOptions): Promise<PurchaseList> {
  await readCustomer(db, customerUuid)
  const conditions = ['p.customer_id = ?']
  const values: (string | number)[] = [customerUuid]
  if (query.dateFrom) { conditions.push('COALESCE(p.purchase_date,substr(p.created_at,1,10)) >= ?'); values.push(query.dateFrom) }
  if (query.dateTo) { conditions.push('COALESCE(p.purchase_date,substr(p.created_at,1,10)) <= ?'); values.push(query.dateTo) }
  if (query.category) { conditions.push('EXISTS (SELECT 1 FROM purchase_items AS i WHERE i.purchase_id = p.id AND i.product_category = ?)'); values.push(query.category) }
  const where = conditions.join(' AND ')
  const results = await runD1Batch(db, [
    db.prepare(`SELECT ${purchaseColumns} FROM purchases AS p
      WHERE ${where}
      ORDER BY COALESCE(p.purchase_date,substr(p.created_at,1,10)) DESC,p.created_at DESC,p.id ASC LIMIT ? OFFSET ?`)
      .bind(...values, query.pageSize, (query.page - 1) * query.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM purchases AS p WHERE ${where}`).bind(...values),
  ])
  const { total } = results[1].results[0] as { total: number }
  return pageResult(results[0].results as Purchase[], total, query)
}

export async function getPurchase(db: D1Database, customerUuid: string, purchaseUuid: string): Promise<PurchaseDetail> {
  await readCustomer(db, customerUuid)
  const results = await runD1Batch(db, [
    db.prepare(`SELECT ${purchaseColumns} FROM purchases AS p WHERE p.customer_id = ? AND p.id = ?`)
      .bind(customerUuid, purchaseUuid),
    db.prepare(`SELECT ${itemColumns} FROM purchase_items AS i JOIN purchases AS p ON p.id = i.purchase_id
      WHERE p.customer_id = ? AND p.id = ? ORDER BY i.sort_order ASC,i.id ASC`)
      .bind(customerUuid, purchaseUuid),
  ])
  const purchase = results[0].results[0] as Purchase | undefined
  if (!purchase) throw new HttpError(404, 'PURCHASE_NOT_FOUND', 'The purchase was not found for this customer.')
  return { ...publicPurchase(purchase), items: results[1].results as PurchaseItemSnapshot[] }
}

export async function createPurchase(db: D1Database, customerUuid: string, input: PurchaseCreateInput, actor: PurchaseActor): Promise<PurchaseDetail> {
  const prepared = preparePurchase(input)
  const customer = await readCustomer(db, customerUuid)
  assertCustomerActive(customer)
  await assertPrescription(db, customerUuid, prepared.values.prescription_uuid)
  const purchaseUuid = crypto.randomUUID()
  const auditUuid = crypto.randomUUID()
  const now = new Date().toISOString()
  const header = db.prepare(`INSERT INTO purchases(
      id,customer_id,prescription_id,status,currency_code,purchase_date,subtotal_paise,discount_paise,
      taxable_amount_paise,tax_paise,cgst_paise,sgst_paise,igst_paise,tax_type,total_paise,notes,
      created_at,updated_at,created_by_admin_id,updated_by_admin_id,client_request_id,item_count,creation_audit_id)
    SELECT ?,c.uuid,?,'draft','INR',?,?,?, ?,0,0,0,0,'none',?,?,?,?,?,?,?,?,?
    FROM customers AS c
    WHERE c.uuid = ? AND c.archived_at IS NULL
      AND (? IS NULL OR EXISTS (SELECT 1 FROM prescriptions AS rx
        WHERE rx.id = ? AND rx.customer_id = c.uuid))`)
    .bind(purchaseUuid, prepared.values.prescription_uuid, prepared.values.purchase_date,
       prepared.subtotalPaise, prepared.discountPaise, prepared.totalPaise,
       prepared.totalPaise, prepared.values.notes, now, now, actor.adminId, actor.adminId,
       prepared.values.client_request_id, prepared.items.length, auditUuid, customerUuid, prepared.values.prescription_uuid, prepared.values.prescription_uuid)
  // One bound JSON array inserts all snapshots, keeping the transaction at five
  // statements even for 100 lines and within D1 Free's per-invocation query cap.
  // JSON numbers here are already validated safe integer paise/quantities.
  const items = db.prepare(`INSERT INTO purchase_items(
      id,purchase_id,prescription_id,line_type,description,sku,quantity,unit_price_paise,discount_paise,
      tax_paise,line_total_paise,sort_order,created_at,updated_at,created_by_admin_id,updated_by_admin_id,
      product_category,taxable_paise,tax_rate_basis_points,tax_type,hsn_sac_code,snapshot_position)
      SELECT json_extract(j.value,'$.id'),p.id,NULL,'product',json_extract(j.value,'$.description'),NULL,
        json_extract(j.value,'$.quantity'),json_extract(j.value,'$.unitPricePaise'),json_extract(j.value,'$.discountPaise'),
        0,json_extract(j.value,'$.lineTotalPaise'),j.key,p.created_at,p.updated_at,p.created_by_admin_id,p.updated_by_admin_id,
        json_extract(j.value,'$.productCategory'),json_extract(j.value,'$.lineTotalPaise'),0,'none',NULL,j.key
      FROM purchases AS p JOIN json_each(?) AS j WHERE p.customer_id = ? AND p.id = ? ORDER BY j.key`)
    .bind(JSON.stringify(prepared.items), customerUuid, purchaseUuid)
  const statements: D1PreparedStatement[] = [header, items]
  statements.push(prepareAudit(db, customerUuid, purchaseUuid, auditUuid, actor, now))
  statements.push(db.prepare(`SELECT ${purchaseColumns} FROM purchases AS p WHERE p.customer_id = ? AND p.id = ?`).bind(customerUuid, purchaseUuid))
  statements.push(db.prepare(`SELECT ${itemColumns} FROM purchase_items AS i WHERE i.purchase_id = ? ORDER BY i.sort_order ASC,i.id ASC`).bind(purchaseUuid))
  try {
    const results = await runD1Batch(db, statements)
    if (results[0].meta.changes !== 1) {
      assertCustomerActive(await readCustomer(db, customerUuid))
      await assertPrescription(db, customerUuid, prepared.values.prescription_uuid)
      throw new HttpError(409, 'PURCHASE_NOT_CREATED', 'The purchase could not be created. Please try again.')
    }
    return { ...(results[results.length - 2].results[0] as Purchase), items: results[results.length - 1].results as PurchaseItemSnapshot[] }
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Error && /UNIQUE constraint failed: purchases\.customer_id, purchases\.client_request_id|uq_purchases_customer_submission/u.test(error.message)) {
      throw new HttpError(409, 'PURCHASE_DUPLICATE', 'This purchase submission has already been saved. Open purchase history before creating another purchase.')
    }
    if (error instanceof Error && /purchase prescription must belong|item prescription must belong/iu.test(error.message)) {
      throw new HttpError(400, 'PRESCRIPTION_NOT_FOUND', 'The prescription was not found for this customer.')
    }
    throw error
  }
}
