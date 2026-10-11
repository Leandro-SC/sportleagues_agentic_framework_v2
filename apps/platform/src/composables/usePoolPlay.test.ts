import { describe, expect, it, vi } from 'vitest'
import { usePoolPlay } from './usePoolPlay'
import type { SportsAdminClient } from './useSportsAdmin'

type Tables = Record<string, Record<string, unknown>[]>

// Cliente simulado con filtros .eq/.in (thenable plano) y registro de RPC.
function fake(tables: Tables, rpcImpl: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null } = () => ({})) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => ({ data: null, error: null, ...rpcImpl(fn, args) }))
  const client: SportsAdminClient = {
    from: (table) => ({
      select: () => {
        let rows = [...(tables[table] ?? [])]
        const query = {
          eq: (c: string, v: string) => { rows = rows.filter((r) => r[c] === v); return query },
          in: (c: string, v: string[]) => { rows = rows.filter((r) => v.includes(r[c] as string)); return query },
          order: () => query,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
        }
        return query as never
      },
    }),
    rpc,
  }
  return { client, rpc }
}

const tables = (overrides: Tables = {}): Tables => ({
  pools: [{ id: 'p1', tenant_id: 't1' }],
  tenants: [{ id: 't1', timezone: 'America/Lima' }],
  participants: [{ id: 'part-me', pool_id: 'p1', profile_id: 'me', approval_status: 'approved', withdrawn_at: null }],
  pool_matches: [{ id: 'pm1', pool_id: 'p1', match_id: 'm1', lock_at: '2026-10-12T12:00:00Z' }, { id: 'pm2', pool_id: 'p1', match_id: 'm2', lock_at: '2026-10-13T12:00:00Z' }],
  matches: [
    { id: 'm1', round_id: 'r1', home_team_id: 'a', away_team_id: 'b', starts_at: '2026-10-12T12:15:00Z', status: 'final' },
    { id: 'm2', round_id: 'r2', home_team_id: 'b', away_team_id: 'a', starts_at: '2026-10-13T12:15:00Z', status: 'scheduled' },
  ],
  teams: [{ id: 'a', name: 'Alianza', short_name: 'ALI' }, { id: 'b', name: 'Cristal', short_name: null }],
  rounds: [{ id: 'r1', name: 'Fecha 1', sort_order: 1 }, { id: 'r2', name: 'Fecha 2', sort_order: 2 }],
  official_results: [{ match_id: 'm1', home_score: 2, away_score: 1, revision: 2 }],
  predictions: [{ id: 'pr1', pool_id: 'p1', pool_match_id: 'pm1', participant_id: 'part-me', home_score: 2, away_score: 1 }, { id: 'prX', pool_id: 'p1', pool_match_id: 'pm1', participant_id: 'otro', home_score: 0, away_score: 0 }],
  scoring_events: [
    { prediction_id: 'pr1', points: 2, result_revision: 1, rule_version: 1 },
    { prediction_id: 'pr1', points: 5, result_revision: 2, rule_version: 1 },
  ],
  ...overrides,
})

describe('usePoolPlay', () => {
  it('arma la parrilla con el lock del servidor, mi pronóstico, el resultado y los puntos de la revisión más reciente', async () => {
    const { client } = fake(tables(), (fn) => (fn === 'pool_leaderboard' ? { data: [{ rank: 1, participant_id: 'part-me', display_name: 'Yo', points: '5', exact_hits: 1, outcome_hits: 0, played: 1, current_streak: 1, best_streak: 1, is_me: true }] } : {}))
    const play = usePoolPlay(() => client)
    await play.load('p1', 'me')

    expect(play.error.value).toBe('')
    expect(play.tenantTimezone.value).toBe('America/Lima')
    expect(play.participation.value).toBe('participant')
    expect(play.fixture.value.map((f) => f.roundName)).toEqual(['Fecha 1', 'Fecha 2'])
    const first = play.fixture.value[0]!
    expect(first).toMatchObject({ homeName: 'Alianza', awayName: 'Cristal', lockAt: '2026-10-12T12:00:00Z', mine: { home: 2, away: 1 }, result: { home: 2, away: 1, revision: 2 }, points: 5 })
    expect(play.fixture.value[1]!.mine).toBeNull()
    expect(play.myRow.value?.points).toBe(5)   // el RPC devuelve bigint como texto: se normaliza a número
  })

  it('no toma como mío el pronóstico de otro participante', async () => {
    const { client } = fake(tables())
    const play = usePoolPlay(() => client)
    await play.load('p1', 'me')
    expect(play.fixture.value[0]!.mine).toEqual({ home: 2, away: 1 })
  })

  it('quien no participa (p. ej. el administrador) no puede pronosticar', async () => {
    const { client } = fake(tables({ participants: [] }))
    const play = usePoolPlay(() => client)
    await play.load('p1', 'me')
    expect(play.participation.value).toBe('none')
    expect(play.canPredict.value).toBe(false)
  })

  it('una inscripción pendiente o retirada no habilita pronósticos', async () => {
    const pending = usePoolPlay(() => fake(tables({ participants: [{ id: 'x', pool_id: 'p1', profile_id: 'me', approval_status: 'pending', withdrawn_at: null }] })).client)
    await pending.load('p1', 'me')
    expect(pending.participation.value).toBe('pending')
    const withdrawn = usePoolPlay(() => fake(tables({ participants: [{ id: 'x', pool_id: 'p1', profile_id: 'me', approval_status: 'approved', withdrawn_at: '2026-10-01T00:00:00Z' }] })).client)
    await withdrawn.load('p1', 'me')
    expect(withdrawn.participation.value).toBe('none')
  })

  it('guarda por RPC y refresca; un rechazo se traduce y recarga el estado real', async () => {
    const ok = fake(tables())
    const play = usePoolPlay(() => ok.client)
    await play.load('p1', 'me')
    expect(await play.savePrediction('m2', 1, 0)).toBeNull()
    expect(ok.rpc).toHaveBeenCalledWith('save_prediction', { p_pool_id: 'p1', p_match_id: 'm2', p_home_score: 1, p_away_score: 0 })

    const locked = fake(tables(), (fn) => (fn === 'save_prediction' ? { error: { message: 'prediction is unavailable, unauthorized, or locked', code: '42501' } } : {}))
    const play2 = usePoolPlay(() => locked.client)
    await play2.load('p1', 'me')
    const message = await play2.savePrediction('m1', 3, 3)
    expect(message).toMatch(/cerrado/)
    expect(message).not.toMatch(/unauthorized/)
    expect(play2.savingMatchId.value).toBe('')
  })

  it('pide la tabla por jornada al servidor', async () => {
    const { client, rpc } = fake(tables())
    const play = usePoolPlay(() => client)
    await play.load('p1', 'me')
    await play.loadLeaderboard('r2')
    expect(rpc).toHaveBeenLastCalledWith('pool_leaderboard', { p_pool_id: 'p1', p_round_id: 'r2' })
  })

  it('muestra un error genérico si la lectura falla', async () => {
    const broken: SportsAdminClient = { from: () => { throw new Error('boom') }, rpc: vi.fn() }
    const play = usePoolPlay(() => broken)
    await play.load('p1', 'me')
    expect(play.error.value).toBe('No fue posible cargar la quiniela.')
    expect(play.loading.value).toBe(false)
  })
})
