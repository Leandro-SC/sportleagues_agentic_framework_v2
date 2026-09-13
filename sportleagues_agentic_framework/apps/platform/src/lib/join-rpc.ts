import { normalizeJoinCode } from './join-intent'

export type JoinResult = { pool_id: string; tenant_id: string; id: string; approval_status: 'pending' | 'approved' }
export type JoinRpcClient = { rpc: (name: 'join_pool', args: { p_code: string }) => PromiseLike<{ data: JoinResult | null; error: { message: string } | null }> }

export async function requestJoinPool(client: JoinRpcClient, rawCode: string): Promise<{ data: JoinResult | null; error: string | null }> {
  const code = normalizeJoinCode(rawCode)
  if (!code) return { data: null, error: 'El código de unión no es válido.' }
  const { data, error } = await client.rpc('join_pool', { p_code: code })
  return { data, error: error?.message ?? (data ? null : 'No fue posible unirse a la quiniela.') }
}
