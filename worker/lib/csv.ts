import { REPORT_EXPORT_BYTES } from '../../shared/reports.js'
import { HttpError } from './errors.js'

/** Text is never executable spreadsheet input. Preserve it with a text marker,
 * including +91 phones and formula prefixes hidden behind whitespace/controls. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (typeof value === 'string' && (/^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(text) || /^[\p{Cc}\p{Cf}]/u.test(text))) text = `'${text}`
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
export function createCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).byteLength > REPORT_EXPORT_BYTES) throw new HttpError(413, 'REPORT_EXPORT_TOO_LARGE', 'This CSV exceeds 5 MiB. Choose a smaller date range or use the paginated report.')
  return csv
}

/** Retain the foundation helper's public contract, using the same safe encoder. */
export function csvResponse(rows: readonly Record<string, unknown>[], filename: string): Response {
  const headers = rows.length ? Object.keys(rows[0]) : []
  return new Response(createCsv(headers,rows.map(row => headers.map(header => row[header]))), {
    headers: { 'Cache-Control': 'no-store','Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/gu,'_')}"` },
  })
}
