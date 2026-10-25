import { describe, expect, it, vi } from 'vitest'
import { useSportsAdmin, type SportsAdminClient } from './useSportsAdmin'

type Table = Record<string, unknown[]>
type RpcReply = { data?: unknown; error?: { message: string; code?: string } | null }

// Cliente simulado: tablas en memoria y registro de RPC. No toca la red.
function fakeClient(tables: Table, rpcImpl: (fn: string, args: Record<string, unknown>) => RpcReply = () => ({})) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => ({ data: null, error: null, ...rpcImpl(fn, args) }))
  const client: SportsAdminClient = {
    from: (table) => ({
      select: () => {
        let rows = [...(tables[table] ?? [])] as Record<string, unknown>[]
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
  tournaments: [{ id: 'to-1', tenant_id: TENANT, name: 'Liga', sport_code: 'football', country_code: null, season_label: null, color: null, results_mode: 'manual' }],
  teams: [], tournament_teams: [], rounds: [], matches: [], official_results: [], pool_matches: [],
}

describe('useSportsAdmin · catálogo compartido y modo de resultados', () => {
  it('importa equipos del catálogo en lotes de 60 y suma los resultados del servidor', async () => {
    const { client, rpc } = fakeClient(base, (fn) => (fn === 'import_catalog_teams' ? { data: { enrolled: 2, already_enrolled: 1 } } : {}))
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)
    const result = await admin.importCatalogTeams(Array.from({ length: 130 }, (_, i) => `c-${i}`))
    const calls = rpc.mock.calls.filter(([fn]) => fn === 'import_catalog_teams')
    expect(calls.map(([, args]) => (args.p_team_ids as string[]).length)).toEqual([60, 60, 10])
    expect(calls[0]![1]).toMatchObject({ p_tournament_id: 'to-1' })
    expect(result).toEqual({ message: null, enrolled: 6, alreadyEnrolled: 3 })
  })

  it('si un lote falla, se detiene, traduce el error y conserva lo ya incorporado', async () => {
    let n = 0
    const { client, rpc } = fakeClient(base, (fn) => (fn === 'import_catalog_teams' ? (++n === 2 ? { error: { message: 'not authorized', code: '42501' } } : { data: { enrolled: 60, already_enrolled: 0 } }) : {}))
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)
    const result = await admin.importCatalogTeams(Array.from({ length: 130 }, (_, i) => `c-${i}`))
    expect(result.message).toBe('No tienes permisos para realizar esta acción.')
    expect(result.enrolled).toBe(60)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'import_catalog_teams')).toHaveLength(2)
  })

  it('el modo automático solo se informa disponible si el servidor lo confirma con true', async () => {
    const yes = useSportsAdmin(() => fakeClient(base, (fn) => (fn === 'tenant_can_use_auto_results' ? { data: true } : {})).client)
    await yes.loadCatalog(TENANT)
    expect(yes.autoResultsAvailable.value).toBe(true)
    const no = useSportsAdmin(() => fakeClient(base, (fn) => (fn === 'tenant_can_use_auto_results' ? { data: 'true' } : {})).client)
    await no.loadCatalog(TENANT)
    expect(no.autoResultsAvailable.value).toBe(false)
    const failing = useSportsAdmin(() => ({ ...fakeClient(base).client, rpc: vi.fn(async () => { throw new Error('offline') }) }))
    await failing.loadCatalog(TENANT)
    expect(failing.autoResultsAvailable.value).toBe(false)
    expect(failing.error.value).toBe('')
  })

  it('el modo por defecto es manual y cambiarlo pasa por la RPC (el servidor decide)', async () => {
    const { client, rpc } = fakeClient(base)
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)
    expect(admin.resultsMode.value).toBe('manual')
    expect(await admin.setResultsMode('manual')).toBeNull()
    expect(rpc).toHaveBeenCalledWith('set_tournament_results_mode', { p_tournament_id: 'to-1', p_mode: 'manual' })
  })

  it('un rechazo Premium del servidor se muestra como mensaje claro', async () => {
    const { client } = fakeClient(base, (fn) => (fn === 'set_tournament_results_mode' ? { error: { message: 'automatic results require a premium plan that is not available yet', code: '42501' } } : {}))
    const admin = useSportsAdmin(() => client)
    await admin.loadCatalog(TENANT)
    expect(await admin.setResultsMode('automatic')).toMatch(/Premium que aún no está disponible/)
  })
})
