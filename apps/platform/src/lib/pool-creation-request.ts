// Solicitud «Crear mi propia quiniela» (ADR-017, contrato RPC). El cliente SOLO envía una nota
// opcional: nunca tenant_id, rol ni estado. Aprobar o rechazar no existe en el frontend; el servidor
// es la autoridad de todo (idempotencia, longitud de la nota, `already_organizer`, auditoría).
export type PoolCreationRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type PoolCreationRequest = {
  id: string
  status: PoolCreationRequestStatus
  // Solo lo devuelve `request_pool_creation`: false si ya existía una pendiente (idempotente).
  created: boolean | null
  requested_at: string
  reviewed_at: string | null
}

export const POOL_REQUEST_NOTE_MAX = 500
export const POOL_REQUEST_UNAVAILABLE_MESSAGE = 'Función aún no disponible en este entorno'
export const POOL_REQUEST_REVIEW_NOTICE = 'Un operador autorizado revisará tu solicitud; no recibirás permisos hasta que se apruebe.'

const STATUSES: PoolCreationRequestStatus[] = ['pending', 'approved', 'rejected', 'cancelled']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/

export type RpcFailure = { code?: string | null; message?: string | null; details?: string | null }
export type PoolCreationErrorKind = 'unavailable' | 'network' | 'already_organizer' | 'cooldown_active' | 'rate_limited' | 'profile_required' | 'no_pending_request' | 'invalid_note' | 'no_session' | 'unknown'

const codePoints = (value: string): number => Array.from(value).length

// Recorta espacios y caracteres de control; vacío equivale a «sin nota». Validar aquí es solo UX.
export function normalizePoolRequestNote(raw: string): { note: string | null; error: string | null } {
  // eslint-disable-next-line no-control-regex
  const note = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (!note) return { note: null, error: null }
  if (codePoints(note) > POOL_REQUEST_NOTE_MAX) return { note: null, error: `La nota no puede superar ${POOL_REQUEST_NOTE_MAX} caracteres.` }
  return { note, error: null }
}

// Valida la forma del jsonb del servidor; cualquier cosa distinta se trata como «sin solicitud».
export function parsePoolCreationRequest(raw: unknown): PoolCreationRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id) return null
  if (!STATUSES.includes(row.status as PoolCreationRequestStatus)) return null
  if (typeof row.requested_at !== 'string' || !ISO_DATE.test(row.requested_at)) return null
  const reviewed = typeof row.reviewed_at === 'string' && ISO_DATE.test(row.reviewed_at) ? row.reviewed_at : null
  return { id: row.id, status: row.status as PoolCreationRequestStatus, created: typeof row.created === 'boolean' ? row.created : null, requested_at: row.requested_at, reviewed_at: reviewed }
}

// El RPC aún no existe (migración sin aplicar): PostgREST PGRST202 o SQLSTATE 42883.
export function isRpcMissing(error: RpcFailure | null | undefined): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function|function .* does not exist/i.test(error.message ?? '')
}

export function isNetworkFailure(error: unknown): boolean {
  if (!error) return false
  if (error instanceof TypeError) return true
  const message = typeof error === 'object' ? String((error as RpcFailure).message ?? '') : String(error)
  return /failed to fetch|network|load failed|fetch failed/i.test(message)
}

export function classifyPoolCreationError(error: RpcFailure | unknown): PoolCreationErrorKind {
  const failure = (error && typeof error === 'object' ? error : {}) as RpcFailure
  if (isRpcMissing(failure)) return 'unavailable'
  if (isNetworkFailure(error)) return 'network'
  if (failure.code === 'P0001') {
    const text = failure.message ?? ''
    if (/already_organizer/.test(text)) return 'already_organizer'
    if (/cooldown_active/.test(text)) return 'cooldown_active'
    if (/rate_limited/.test(text)) return 'rate_limited'
    if (/profile_required/.test(text)) return 'profile_required'
    if (/no_pending_request/.test(text)) return 'no_pending_request'
  }
  if (failure.code === '22023') return 'invalid_note'
  if (failure.code === '28000') return 'no_session'
  return 'unknown'
}

// El DETAIL de `cooldown_active` trae `retry_after` (ISO). Solo se usa para informar; el servidor decide.
export function extractRetryAfter(error: RpcFailure | unknown): string | null {
  const details = error && typeof error === 'object' ? String((error as RpcFailure).details ?? '') : ''
  const match = details.match(/retry_after\W+(\d{4}-\d{2}-\d{2}[T ][0-9:.+\-Z]+)/)
  if (!match) return null
  const iso = match[1].replace(' ', 'T')
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

export function humanizePoolCreationError(kind: PoolCreationErrorKind, retryAfter: string | null = null): string {
  switch (kind) {
    case 'unavailable': return POOL_REQUEST_UNAVAILABLE_MESSAGE
    case 'network': return 'No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.'
    case 'already_organizer': return 'Ya administras una organización; no necesitas enviar una solicitud.'
    case 'cooldown_active': {
      const date = retryAfter ? new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(retryAfter)) : null
      return date ? `Tu solicitud anterior no fue aprobada hace poco. Podrás enviar otra a partir del ${date}.` : 'Tu solicitud anterior no fue aprobada hace poco. Inténtalo de nuevo en unos días.'
    }
    case 'rate_limited': return 'Demasiados intentos, inténtalo más tarde.'
    case 'profile_required': return 'Completa tu perfil antes de enviar la solicitud (Inicio, «Completar perfil»).'
    case 'no_pending_request': return 'No tienes una solicitud pendiente; actualizamos tu estado.'
    case 'invalid_note': return `La nota no es válida. Usa como máximo ${POOL_REQUEST_NOTE_MAX} caracteres.`
    case 'no_session': return 'Tu sesión expiró. Inicia sesión de nuevo para enviar la solicitud.'
    default: return 'No pudimos completar la solicitud. Inténtalo de nuevo.'
  }
}

export const STATUS_COPY: Record<PoolCreationRequestStatus, { label: string; detail: string }> = {
  pending: { label: 'Solicitud pendiente', detail: POOL_REQUEST_REVIEW_NOTICE },
  approved: { label: 'Solicitud aprobada', detail: 'Un operador ya creó tu organización. Cierra y vuelve a abrir la app (o recarga la página) para que aparezca el Modo organizador en Inicio; el acceso se activa con tu membresía, no con este aviso.' },
  rejected: { label: 'Solicitud no aprobada', detail: 'Un operador revisó tu solicitud y no fue aprobada. Puedes enviar una nueva cuando quieras.' },
  cancelled: { label: 'Solicitud cancelada', detail: 'Cancelaste tu solicitud anterior. Puedes enviar una nueva cuando quieras.' },
}
