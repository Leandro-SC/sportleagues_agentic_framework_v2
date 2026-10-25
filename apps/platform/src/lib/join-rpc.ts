import { normalizeJoinCode } from './join-intent'

export type JoinResult = { pool_id: string; tenant_id: string; id: string; approval_status: 'pending' | 'approved' }
type JoinRpcError = { message: string; code?: string; hint?: string }
export type JoinRpcClient = { rpc: (name: 'join_pool', args: { p_code: string }) => PromiseLike<{ data: JoinResult | null; error: JoinRpcError | null }> }

const OFFLINE_MESSAGE = 'Sin conexión. Inténtalo de nuevo en unos segundos.'
export const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró. Vuelve a iniciar sesión para unirte; tu invitación sigue guardada.'

// Fallo transitorio: la petición no llegó a una respuesta del servidor (red caída, tiempo agotado).
// Un rechazo del servidor (código inválido, sin permiso) trae `code` de PostgREST/Postgres y NO lo es.
function isTransient(error: JoinRpcError): boolean {
  return !error.code && /fetch|network|timeout|timed out|load failed|offline|abort/i.test(error.message)
}

// JWT vencido o ausente: PostgREST responde `PGRST301`/`PGRST303` (o 401 con mensaje JWT) y `join_pool` lanza 28000.
// No es un rechazo del código: la invitación es válida y debe conservarse hasta volver a iniciar sesión (FE-07).
function isSessionProblem(error: JoinRpcError): boolean {
  return error.code === '28000' || error.code === 'PGRST301' || error.code === 'PGRST303' || /jwt|authentication required|not authenticated/i.test(error.message)
}

/** Mensaje amigable a partir del rechazo del servidor. Nunca reenvía `message` crudo (ADR-013 §5). */
export function joinErrorMessage(error: JoinRpcError): string {
  const text = `${error.message} ${error.hint ?? ''}`
  if (/ADMIN_PARTICIPANT_INCOMPATIBLE|administrators of a pool/i.test(text)) return 'Quien administra una quiniela no participa en ella.'
  if (/WITHDRAWN|withdrawn participation/i.test(text)) return 'Ya te retiraste de esta quiniela y no puedes volver a unirte.'
  if (/free participant limit/i.test(text)) return 'Esta quiniela alcanzó el límite de participantes de su plan.'
  if (/invalid|expired|pool is not open/i.test(text)) return 'El código no es válido, expiró o la quiniela no está disponible.'
  if (error.code === '42501') return 'No tienes autorización para unirte a esta quiniela.'
  return 'No fue posible unirse a la quiniela. Inténtalo de nuevo.'
}

export type JoinRequestResult = { data: JoinResult | null; error: string | null; transient?: true; sessionExpired?: true }

export async function requestJoinPool(client: JoinRpcClient, rawCode: string): Promise<JoinRequestResult> {
  const code = normalizeJoinCode(rawCode)
  if (!code) return { data: null, error: 'El código de unión no es válido.' }
  let response: Awaited<ReturnType<JoinRpcClient['rpc']>>
  try { response = await client.rpc('join_pool', { p_code: code }) } catch { return { data: null, error: OFFLINE_MESSAGE, transient: true } }
  const { data, error } = response
  if (error && isTransient(error)) return { data: null, error: OFFLINE_MESSAGE, transient: true }
  if (error && isSessionProblem(error)) return { data: null, error: SESSION_EXPIRED_MESSAGE, sessionExpired: true }
  if (error) return { data: null, error: joinErrorMessage(error) }
  return { data, error: data ? null : 'No fue posible unirse a la quiniela. Inténtalo de nuevo.' }
}
