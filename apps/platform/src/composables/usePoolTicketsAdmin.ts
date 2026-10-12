import { ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import { humanizeTicketError } from '../lib/tickets'
import type { SportsAdminClient } from './useSportsAdmin'

export type SellableRound = { roundId: string; roundName: string; sortOrder: number; max: number }
type Row = Record<string, unknown>

// Administración de tickets de una quiniela (organizador): habilitar tickets (irreversible) y fijar el máximo por jornada vendible.
// La autorización y las reglas (sin pronósticos previos, venta aún abierta, límite ≥ lo emitido) las impone el servidor.
export function usePoolTicketsAdmin(clientFactory: () => SportsAdminClient = () => getSupabaseClient() as unknown as SportsAdminClient) {
  const rounds = ref<SellableRound[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  async function select(table: string, columns: string, shape: (q: ReturnType<ReturnType<SportsAdminClient['from']>['select']>) => ReturnType<ReturnType<SportsAdminClient['from']>['select']>): Promise<Row[]> {
    const { data, error: readError } = await shape(clientFactory().from(table).select(columns))
    if (readError) throw new Error(readError.message)
    return (data ?? []) as Row[]
  }

  async function load(poolId: string): Promise<void> {
    loading.value = true; error.value = ''
    try {
      const limits = await select('pool_rounds', 'round_id, max_tickets_per_participant', (q) => q.eq('pool_id', poolId))
      const ids = limits.map((l) => l.round_id as string)
      const names = ids.length ? await select('rounds', 'id, name, sort_order', (q) => q.in('id', ids)) : []
      rounds.value = limits.map((l) => {
        const r = names.find((n) => n.id === l.round_id)
        return { roundId: l.round_id as string, roundName: (r?.name as string) ?? '—', sortOrder: Number(r?.sort_order ?? 0), max: Number(l.max_tickets_per_participant) }
      }).sort((a, b) => a.sortOrder - b.sortOrder)
    } catch {
      error.value = 'No fue posible cargar los tickets de la quiniela.'
    } finally {
      loading.value = false
    }
  }

  async function call(fn: string, args: Record<string, unknown>, poolId: string): Promise<string | null> {
    saving.value = true
    try {
      const { error: rpcError } = await clientFactory().rpc(fn, args)
      if (rpcError) {
        return /already has predictions|cannot be enabled on a pool/.test(rpcError.message)
          ? 'Esta quiniela ya tiene pronósticos: los tickets solo se habilitan antes del primer pronóstico.'
          : /lower than tickets already issued/.test(rpcError.message) ? 'El máximo no puede ser menor que los tickets ya emitidos.'
          : /sales for this round are closed/.test(rpcError.message) ? 'La venta de esta jornada ya cerró; no se puede cambiar el máximo.'
          : humanizeTicketError(rpcError.code, rpcError.message, rpcError.hint)
      }
      await load(poolId)
      return null
    } catch {
      return humanizeTicketError(null, null)
    } finally {
      saving.value = false
    }
  }

  const enable = (poolId: string, defaultMax = 1): Promise<string | null> => call('enable_pool_tickets', { p_pool_id: poolId, p_default_max: defaultMax }, poolId)
  const setLimit = (poolId: string, roundId: string, max: number): Promise<string | null> => call('configure_pool_round', { p_pool_id: poolId, p_round_id: roundId, p_max: max }, poolId)

  return { rounds, loading, saving, error, load, enable, setLimit }
}
