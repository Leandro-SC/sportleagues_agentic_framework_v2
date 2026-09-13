export type PoolSummary = { id: string; name: string }

export function resolvePoolAccess(data: PoolSummary | null): { pool: PoolSummary | null; denied: boolean } {
  return data ? { pool: data, denied: false } : { pool: null, denied: true }
}
