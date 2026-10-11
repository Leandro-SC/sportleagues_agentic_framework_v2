import { describe, expect, it, vi } from 'vitest'
import { useSportsAdmin, type SportsAdminClient } from './useSportsAdmin'

type Table = Record<string, unknown[]>

// Cliente simulado: tablas en memoria, filtros .eq/.in y registro de RPC. No toca la red.
function fakeClient(tables: Table, rpcImpl: (fn: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string; code?: string } | null } = () => ({ data: null, error: null })) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => ({ data: null, error: null, ...rpcImpl(fn, args) }))
  const client: SportsAdminClient = {
    from: (table) => ({
      select: () => {
        let rows = [...(tables[table] ?? [])] as Record<string, unknown>[]
        // thenable plano (await sobre una Promise nativa ignoraría un `then` sobrescrito)
        const query = {
          eq: (column: string, value: string) => { rows = rows.filter((row) => row[column] === value); return query },
          in: (column: string, values: string[]) => { rows = rows.filter((row) => values.includes(row[column] as string)); return query },
          order: () => query,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
        }
        return query as unknown as ReturnType<ReturnType<SportsAdminClient['from']>['select']>
      },
    }),
    rpc,
  }
  return { client, rpc }
}

const TENANT = 't-1'
const base: Table = {
  tenants: [{ id: TENANT, timezone: 'America/Lima' }],
  tournaments: [{ id: 'to-1', tenant_id: TENANT, name: 'Liga', sport_code: 'football', country_code: null, season_label: null, color: null }, { id: 'to-x', tenant_id: 'otro', name: 'Ajena', sport_code: 'football', country_code: null, season_label: null, color: null }],
  teams: [{ id: 'te-1', tenant_id: TENANT, name: 'Alianza', short_name: null, country_code: null, primary_color: null, secondary_color: null }],
  tournament_teams: [{ tournament_id: 'to-1', team_id: 'te-1' }],
  rounds: [{ id: 'r-1', tournament_id: 'to-1', name: 'Fecha 1', sort_order: 0 }],
  matches: [{ id: 'm-1', tournament_id: 'to-1', round_id: 'r-1', home_team_id: 'te-1', away_team_id: 'te-1', starts_at: '2026-10-13T01:30:00Z', status: 'final' }],
  official_results: [{ match_id: 'm-1', home_score: 2, away_score: 1, revision: 3 }],
  pool_matches: [{ pool_id: 'p-1', match_id: 'm-1' }],
}

describe('useSportsAdmin', () => {
  it('carga catálogo del tenant, zona horaria, inscripción, jornadas, partidos y resultados', async () => {
    const { client } = fakeClient(base)
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)

    expect(admin.error.value).toBe('')
    expect(admin.timezone.value).toBe('America/Lima')
    expect(admin.tournaments.value.map((tournament) => tournament.id)).toEqual(['to-1'])   // la del otro tenant no entra
    expect(admin.selectedTournamentId.value).toBe('to-1')
    expect(admin.enrolledTeams.value.map((team) => team.name)).toEqual(['Alianza'])
    expect(admin.rounds.value).toHaveLength(1)
    expect(admin.matches.value).toHaveLength(1)
    expect(admin.results.value['m-1']?.revision).toBe(3)
  })

  it('publica con la revisión esperada vigente (0 si aún no hay resultado)', async () => {
    const { client, rpc } = fakeClient(base)
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)

    expect(await admin.publishResult('m-1', 3, 3)).toBeNull()
    expect(rpc).toHaveBeenCalledWith('publish_official_result', { p_match_id: 'm-1', p_home_score: 3, p_away_score: 3, p_expected_revision: 3 })
    await admin.publishResult('m-sin-resultado', 1, 0)
    expect(rpc).toHaveBeenLastCalledWith('publish_official_result', { p_match_id: 'm-sin-resultado', p_home_score: 1, p_away_score: 0, p_expected_revision: 0 })
  })

  it('traduce un conflicto de revisión sin filtrar el mensaje interno', async () => {
    const { client } = fakeClient(base, () => ({ error: { message: 'revision conflict', code: '40001' } }))
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)

    const message = await admin.publishResult('m-1', 1, 0)
    expect(message).toMatch(/cambió mientras lo editabas/)
    expect(message).not.toMatch(/revision conflict/)
  })

  it('crea y programa por RPC sin escribir tablas directamente', async () => {
    const { client, rpc } = fakeClient(base)
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)

    await admin.saveMatch({ roundId: 'r-1', homeTeamId: 'te-1', awayTeamId: 'te-2', startsAtIso: '2026-10-14T00:00:00.000Z' })
    expect(rpc).toHaveBeenCalledWith('upsert_match', { p_tournament_id: 'to-1', p_match_id: null, p_round_id: 'r-1', p_home_team_id: 'te-1', p_away_team_id: 'te-2', p_starts_at: '2026-10-14T00:00:00.000Z' })
    await admin.saveRound({ name: 'Fecha 2', sortOrder: 1 })
    expect(rpc).toHaveBeenCalledWith('upsert_round', { p_tournament_id: 'to-1', p_round_id: null, p_name: 'Fecha 2', p_sort_order: 1 })
    await admin.reorderRounds(['r-2', 'r-1'])
    expect(rpc).toHaveBeenCalledWith('reorder_rounds', { p_tournament_id: 'to-1', p_round_ids: ['r-2', 'r-1'] })
  })

  it('el alta exprés de equipos los crea y los inscribe en el torneo activo', async () => {
    let n = 0
    const { client, rpc } = fakeClient(base, (fn) => (fn === 'upsert_team' ? { data: { id: `nuevo-${++n}` } } : {}))
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)

    expect(await admin.addTeamsInBulk([{ name: 'Cristal', shortName: 'CRI' }, { name: 'Melgar', shortName: null }])).toBeNull()
    const enrol = rpc.mock.calls.filter(([fn]) => fn === 'set_tournament_team').map(([, args]) => args)
    expect(enrol).toEqual([
      { p_tournament_id: 'to-1', p_team_id: 'nuevo-1', p_enrolled: true },
      { p_tournament_id: 'to-1', p_team_id: 'nuevo-2', p_enrolled: true },
    ])
  })

  it('se detiene en el primer error del alta exprés', async () => {
    const { client, rpc } = fakeClient(base, (fn) => (fn === 'upsert_team' ? { error: { message: 'duplicate key', code: '23505' } } : {}))
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)

    expect(await admin.addTeamsInBulk([{ name: 'Alianza', shortName: null }, { name: 'Otro', shortName: null }])).toMatch(/Ya existe/)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'upsert_team')).toHaveLength(1)
  })

  it('lee las asociaciones de la quiniela y las actualiza tras incluir/quitar', async () => {
    const { client, rpc } = fakeClient(base)
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)
    await admin.loadPoolMatches('p-1')
    expect(admin.poolMatchIds.value).toEqual(['m-1'])

    await admin.setPoolMatch('p-1', 'm-1', false)
    expect(rpc).toHaveBeenCalledWith('set_pool_match', { p_pool_id: 'p-1', p_match_id: 'm-1', p_included: false })
  })

  it('muestra un error genérico si la lectura falla', async () => {
    const failing: SportsAdminClient = {
      from: () => ({ select: () => { throw new Error('boom') } }),
      rpc: vi.fn(),
    }
    const admin = useSportsAdmin(() => failing)
    await admin.loadCatalog(TENANT)
    expect(admin.error.value).toBe('No fue posible cargar la parrilla.')
    expect(admin.loading.value).toBe(false)
  })
})
