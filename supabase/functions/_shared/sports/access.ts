// ADR-021 / F-05, F-10. Piezas puras (sin Deno ni Supabase) del control de acceso de `sports-sync`: comparación de secreto en tiempo constante,
// lectura de cuerpo con tope en bytes y validación estricta de la petición. Se prueban con vitest.

// Cuerpo máximo aceptado. La petición más larga legítima (`search` con 60 caracteres + `tenant_id`) ronda los 200 bytes.
export const MAX_BODY_BYTES = 2048
// Longitud mínima del secreto interno; por debajo se considera NO configurado (la función rechaza todo: falla cerrado).
export const MIN_SECRET_LENGTH = 32

export type Operation = 'search' | 'import_season' | 'sync'

export type ParsedRequest =
  | { action: 'search'; query: string; tenantId: string | null }
  | { action: 'import_season'; competition: string; year: number; tenantId: string | null }
  | { action: 'sync' }

const encoder = new TextEncoder()

export async function constantTimeEqual(expected: string, received: string): Promise<boolean> {
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(expected)), crypto.subtle.digest('SHA-256', encoder.encode(received))])
  const left = new Uint8Array(a)
  const right = new Uint8Array(b)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}

export type BoundedRead = { ok: true; text: string } | { ok: false; reason: 'too_large' | 'unreadable' }

// Lee el cuerpo con un tope duro: rechaza por `Content-Length` declarado y, como ese encabezado falta o miente en `chunked`, también cuenta los bytes
// realmente recibidos y cancela el flujo al superar el tope (F-10).
export async function readBoundedText(request: Request, maxBytes: number = MAX_BODY_BYTES): Promise<BoundedRead> {
  const declared = request.headers.get('content-length')
  if (declared !== null) {
    if (!/^[0-9]{1,12}$/.test(declared)) return { ok: false, reason: 'unreadable' }
    if (Number(declared) > maxBytes) return { ok: false, reason: 'too_large' }
  }
  if (!request.body) return { ok: true, text: '' }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ALLOWED_KEYS = new Set(['action', 'query', 'competition', 'year', 'tenant_id'])

// Validación estricta: solo claves conocidas, tipos exactos, sin valores por defecto implícitos. `tenant_id` es solo ATRIBUCIÓN contable que informa un
// proceso backend de confianza (la base de datos comprueba que exista y deriva su plan; nunca autoriza acceso a datos del tenant).
export function parseRequest(raw: unknown): ParsedRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const body = raw as Record<string, unknown>
  for (const key of Object.keys(body)) if (!ALLOWED_KEYS.has(key)) return null
  const tenant = body.tenant_id
  if (tenant !== undefined && (typeof tenant !== 'string' || !UUID.test(tenant))) return null
  const tenantId = typeof tenant === 'string' ? tenant.toLowerCase() : null
  switch (body.action) {
    case 'search': {
      if (typeof body.query !== 'string' || body.query.length > 200 || body.competition !== undefined || body.year !== undefined) return null
      return { action: 'search', query: body.query, tenantId }
    }
    case 'import_season': {
      if (typeof body.competition !== 'string' || !/^[0-9]{1,9}$/.test(body.competition) || body.query !== undefined) return null
      if (typeof body.year !== 'number' || !Number.isInteger(body.year) || body.year < 1990 || body.year > 2100) return null
      return { action: 'import_season', competition: body.competition, year: body.year, tenantId }
    }
    case 'sync': {
      // El sondeo es de ámbito plataforma: no se atribuye a un tenant.
      if (tenant !== undefined || body.query !== undefined || body.competition !== undefined || body.year !== undefined) return null
      return { action: 'sync' }
    }
    default:
      return null
  }
}

// Motivos de rechazo de la base de datos → estado HTTP. Ninguno incluye datos del tenant ni detalles internos.
export function statusForDenial(reason: string): number {
  switch (reason) {
    case 'GLOBAL_EXHAUSTED':
    case 'GLOBAL_MONTH_EXHAUSTED':
    case 'TENANT_EXHAUSTED':
    case 'TENANT_MONTH_EXHAUSTED':
      return 429
    case 'PROVIDER_NOT_CONFIGURED':
      return 503
    default:
      return 403 // AUTO_RESULTS_OFF · PLAN_NO_ACCESS · TENANT_UNKNOWN y cualquier motivo desconocido
  }
}

export const DENIAL_CODES = new Set([
  'GLOBAL_EXHAUSTED', 'GLOBAL_MONTH_EXHAUSTED', 'TENANT_EXHAUSTED', 'TENANT_MONTH_EXHAUSTED',
  'PROVIDER_NOT_CONFIGURED', 'AUTO_RESULTS_OFF', 'PLAN_NO_ACCESS', 'TENANT_UNKNOWN',
])
