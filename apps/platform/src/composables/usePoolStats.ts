import { ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import type { SportsAdminClient } from './useSportsAdmin'

export type PointsSummaryRow = { pool_id: string; pool_name: string; rank: number; participants: number; points: number; exact_hits: number; current_streak: number }
export type MyStats = { rank: number; participants: number; points: number; exact_hits: number; outcome_hits: number; results_count: number; played: number; hit_rate: number; avg_points: number; best_round_points: number; current_streak: number; best_streak: number }
export type EvolutionPoint = { round_id: string; round_name: string; sort_order: number; my_points: number | null; my_cumulative: number | null; avg_points: number; best_points: number }

const num = (value: unknown): number => Number(value ?? 0)

// «Mis puntos» y rendimiento: todo viene de las RPC del servidor (mismas reglas que la tabla). Si no hay datos, el estado es vacío:
// nunca se muestran cifras de relleno.
export function usePoolStats(clientFactory: () => SportsAdminClient = () => getSupabaseClient() as unknown as SportsAdminClient) {
  const summary = ref<PointsSummaryRow[]>([])
  const stats = ref<MyStats | null>(null)
  const evolution = ref<EvolutionPoint[]>([])
  const loading = ref(false)
  const error = ref('')

  async function loadSummary(): Promise<void> {
    loading.value = true; error.value = ''
    try {
      const { data, error: rpcError } = await clientFactory().rpc('my_points_summary', {})
      if (rpcError) { error.value = 'No fue posible cargar tus puntos.'; summary.value = []; return }
      summary.value = ((data ?? []) as PointsSummaryRow[]).map((row) => ({ ...row, points: num(row.points) }))
    } catch {
      error.value = 'No fue posible cargar tus puntos.'
    } finally {
      loading.value = false
    }
  }

  async function loadPool(poolId: string): Promise<void> {
    const [s, e] = await Promise.all([clientFactory().rpc('my_pool_stats', { p_pool_id: poolId }), clientFactory().rpc('pool_points_evolution', { p_pool_id: poolId })])
    const row = ((s.data ?? []) as Record<string, unknown>[])[0]
    stats.value = s.error || !row ? null : {
      rank: num(row.rank), participants: num(row.participants), points: num(row.points), exact_hits: num(row.exact_hits), outcome_hits: num(row.outcome_hits),
      results_count: num(row.results_count), played: num(row.played), hit_rate: num(row.hit_rate), avg_points: num(row.avg_points),
      best_round_points: num(row.best_round_points), current_streak: num(row.current_streak), best_streak: num(row.best_streak),
    }
    evolution.value = e.error ? [] : ((e.data ?? []) as Record<string, unknown>[]).map((p) => ({
      round_id: p.round_id as string, round_name: p.round_name as string, sort_order: num(p.sort_order),
      my_points: p.my_points == null ? null : num(p.my_points), my_cumulative: p.my_cumulative == null ? null : num(p.my_cumulative),
      avg_points: num(p.avg_points), best_points: num(p.best_points),
    }))
  }

  return { summary, stats, evolution, loading, error, loadSummary, loadPool }
}
