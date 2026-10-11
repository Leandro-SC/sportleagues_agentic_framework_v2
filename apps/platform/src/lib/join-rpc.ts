import { normalizeJoinCode } from './join-intent'

export type JoinResult = { pool_id: string; tenant_id: string; id: string; approval_status: 'pending' | 'approved' }
export type JoinRpcClient = { rpc: (name: 'join_pool', args: { p_code: string }) => PromiseLike<{ data: JoinResult | null; error: { message: string; code?: string } | null }> }

// Fallo transitorio: la petición no llegó a una respuesta del servidor (red caída, tiempo agotado).
// Un rechazo del servidor (código inválido, sin permiso) trae `code` de PostgREST/Postgres y NO lo es.
function isTransient(error: { message: string; code?: string }): boolean {
  return !error.code && /fetch|network|timeout|timed out|load failed|offline|abort/i.test(error.message)
}

export type JoinRequestResult = { data: JoinResult | null; error: string | null; transient?: true }

export async function requestJoinPool(client: JoinRpcClient, rawCode: string): Promise<JoinRequestResult> {
  const code = normalizeJoinCode(rawCode)
  if (!code) return { data: null, error: 'El código de unión no es válido.' }
  let response: Awaited<ReturnType<JoinRpcClient['rpc']>>
  try { response = await client.rpc('join_pool', { p_code: code }) } catch { return { data: null, error: 'Sin conexión. Inténtalo de nuevo en unos segundos.', transient: true } }
  const { data, error } = response
  if (error && isTransient(error)) return { data: null, error: 'Sin conexión. Inténtalo de nuevo en unos segundos.', transient: true }
  return { data, error: error?.message ?? (data ? null : 'No fue posible unirse a la quiniela.') }
}
