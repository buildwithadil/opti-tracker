export function csvResponse(rows: readonly Record<string, unknown>[], filename: string): Response {
  const headers = rows.length ? Object.keys(rows[0]) : []
  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(','))
  return new Response(`\uFEFF${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/gu, '_')}"`,
    },
  })
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text
}
