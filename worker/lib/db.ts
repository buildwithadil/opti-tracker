/**
 * Execute a group of related D1 statements atomically. D1's batch API wraps
 * the statements in one transaction: if one statement fails, none commit.
 * Callers should prepare every write first and avoid side effects outside D1
 * until this promise resolves.
 */
export async function runD1Batch<T = unknown>(
  db: D1Database,
  statements: readonly D1PreparedStatement[],
): Promise<D1Result<T>[]> {
  if (statements.length === 0) {
    return []
  }
  return db.batch<T>([...statements])
}
