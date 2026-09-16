export const BRANDING_BUCKET = 'branding-assets'
export const DEFAULT_BATCH_SIZE = 50
export const MAX_BATCH_SIZE = 50
export const PENDING_TIMEOUT_MS = 60 * 60 * 1000
export const ORPHAN_GRACE_PERIOD_MS = 60 * 60 * 1000
export const CLAIM_TIMEOUT_MS = 15 * 60 * 1000
export const ORPHAN_TENANT_SCAN_LIMIT = 10

export type AssetStatus = 'pending' | 'active' | 'suspended' | 'cleanup_pending' | 'deleted'

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function parseCanonicalStoragePath(path: string): { tenantId: string; assetId: string } | null {
  const parts = path.split('/')
  if (parts.length !== 2 || !isUuid(parts[0]) || !isUuid(parts[1])) return null
  return { tenantId: parts[0], assetId: parts[1] }
}

export function isOlderThan(createdAt: string | null | undefined, ageMs: number, now = Date.now()): boolean {
  if (!createdAt) return false
  const timestamp = Date.parse(createdAt)
  return Number.isFinite(timestamp) && timestamp <= now - ageMs
}

export async function constantTimeEqual(expected: string, received: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [expectedDigest, receivedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
  ])
  const left = new Uint8Array(expectedDigest)
  const right = new Uint8Array(receivedDigest)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export function summaryResponse(runId: string, processed: number, deleted: number, skipped: number, errors: number, inconsistencies: number): Record<string, unknown> {
  return { run_id: runId, processed, deleted, skipped, errors, inconsistencies }
}

export function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

export function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { statusCode?: string | number; status?: number; message?: string }
  return value.status === 404 || value.statusCode === 404 || value.statusCode === '404' || /not found|does not exist/i.test(value.message ?? '')
}
