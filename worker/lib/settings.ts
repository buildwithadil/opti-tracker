import type { AuthenticatedAdmin } from './auth.js'
import { newId, utcNow } from './time.js'
import { normalizeOptionalText, normalizeRequiredText } from './normalize.js'

export const SETTING_DEFAULTS: Record<string, { value: string; valueType: string }> = {
  shop_name: { value: '', valueType: 'string' },
  address: { value: '', valueType: 'string' },
  contact_number: { value: '', valueType: 'string' },
  gstin: { value: '', valueType: 'string' },
  invoice_prefix: { value: 'INV', valueType: 'string' },
  next_invoice_number: { value: '1', valueType: 'integer' },
  invoice_number_padding: { value: '4', valueType: 'integer' },
  currency: { value: 'INR', valueType: 'string' },
  footer_text: { value: '', valueType: 'string' },
  default_tax_rate_basis_points: { value: '0', valueType: 'integer' },
  default_tax_type: { value: 'none', valueType: 'string' },
  business_state: { value: '', valueType: 'string' },
}

export function settingStatements(db: D1Database, adminId: string): D1PreparedStatement[] {
  return Object.entries(SETTING_DEFAULTS).map(([key, setting]) => db.prepare(`
    INSERT INTO settings (id, setting_key, setting_value, value_type, created_by_admin_id, updated_by_admin_id)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM settings WHERE setting_key = ? AND deleted_at IS NULL)
  `).bind(newId(), key, setting.value, setting.valueType, adminId, adminId, key))
}

export async function ensureSettings(db: D1Database, adminId: string): Promise<void> {
  await db.batch(settingStatements(db, adminId))
}

export async function readSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare("SELECT setting_key, setting_value FROM settings WHERE deleted_at IS NULL").all<{ setting_key: string; setting_value: string }>()
  const settings: Record<string, string> = {}
  for (const row of rows.results ?? []) settings[row.setting_key] = row.setting_value
  for (const [key, setting] of Object.entries(SETTING_DEFAULTS)) {
    if (!(key in settings)) settings[key] = setting.value
  }
  return settings
}

export async function updateSettings(db: D1Database, input: Record<string, unknown>, admin: AuthenticatedAdmin): Promise<Record<string, string>> {
  const allowed = new Set(Object.keys(SETTING_DEFAULTS))
  const statements: D1PreparedStatement[] = []
  const now = utcNow()
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue
    const definition = SETTING_DEFAULTS[key]
    let normalized: string
    if (definition.valueType === 'integer') {
      if (typeof value !== 'number' && typeof value !== 'string') throw new Error(`${key} must be an integer`)
      const parsed = Number(value)
      if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${key} must be a non-negative integer`)
      if (key === 'invoice_number_padding' && (parsed < 1 || parsed > 8)) throw new Error('invoice_number_padding must be between 1 and 8')
      if (key === 'default_tax_rate_basis_points' && parsed > 10000) throw new Error('Tax rate cannot exceed 10000 basis points')
      normalized = String(parsed)
    } else {
      normalized = normalizeOptionalText(value, key, 2000) ?? ''
      if (key === 'currency') normalized = normalized.toUpperCase()
      if (key === 'invoice_prefix') normalized = normalizeRequiredText(value, key, 20).toUpperCase().replace(/[^A-Z0-9-]/gu, '')
      if (key === 'default_tax_type' && !['none', 'cgst_sgst', 'igst'].includes(normalized)) throw new Error('Invalid default tax type')
    }
    statements.push(db.prepare(`
      INSERT INTO settings (id, setting_key, setting_value, value_type, created_by_admin_id, updated_by_admin_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).bind(newId(), key, normalized, definition.valueType, admin.id, admin.id))
    statements.push(db.prepare(`UPDATE settings SET setting_value = ?, updated_at = ?, updated_by_admin_id = ? WHERE setting_key = ? AND deleted_at IS NULL`).bind(normalized, now, admin.id, key))
  }
  if (statements.length) await db.batch(statements)
  return readSettings(db)
}

export function invoiceNumber(prefix: string, value: number, padding: number): string {
  return `${prefix || 'INV'}-${String(value).padStart(padding, '0')}`
}
