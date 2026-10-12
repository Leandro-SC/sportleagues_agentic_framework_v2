import { describe, expect, it, vi } from 'vitest'
import { usePoolStats } from './usePoolStats'
import type { SportsAdminClient } from './useSportsAdmin'

const client = (impl: (fn: string) => { data?: unknown; error?: { message: string } | null }) =>
  ({ from: vi.fn(), rpc: vi.fn(async (fn: string) => ({ data: null, error: null, ...impl(fn) })) }) as unknown as SportsAdminClient

describe('usePoolStats', () => {
  it('normaliza los bigint/numeric de PostgREST (texto) a números', async () => {
    const stats = usePoolStats(() => client(() => ({ data: [{ pool_id: 'p', pool_name: 'Liga', rank: 1, participants: 3, points: '12', exact_hits: 2, current_streak: 3 }] })))
    await stats.loadSummary()
    expect(stats.summary.value[0]).toMatchObject({ pool_name: 'Liga', points: 12 })
  })

  it('carga estadísticas y evolución de una quiniela; la evolución propia nula se conserva (no se inventa)', async () => {
    const stats = usePoolStats(() => client((fn) => fn === 'my_pool_stats'
      ? { data: [{ rank: 1, participants: 3, points: '12', exact_hits: 2, outcome_hits: 1, results_count: 3, played: 3, hit_rate: '1.00', avg_points: '4.00', best_round_points: '7', current_streak: 3, best_streak: 3 }] }
      : { data: [{ round_id: 'r1', round_name: 'R1', sort_order: 1, my_points: null, my_cumulative: null, avg_points: '6.33', best_points: '7' }] }))
    await stats.loadPool('p')
    expect(stats.stats.value).toMatchObject({ points: 12, hit_rate: 1, avg_points: 4, best_round_points: 7 })
    expect(stats.evolution.value[0]).toMatchObject({ my_points: null, avg_points: 6.33 })
  })

  it('sin filas (no participa) deja las estadísticas en null', async () => {
    const stats = usePoolStats(() => client(() => ({ data: [] })))
    await stats.loadPool('p')
    expect(stats.stats.value).toBeNull()
    expect(stats.evolution.value).toEqual([])
  })

  it('un error del servidor produce un mensaje y una lista vacía', async () => {
    const stats = usePoolStats(() => client(() => ({ error: { message: 'boom' } })))
    await stats.loadSummary()
    expect(stats.error.value).toBe('No fue posible cargar tus puntos.')
    expect(stats.summary.value).toEqual([])
  })
})
