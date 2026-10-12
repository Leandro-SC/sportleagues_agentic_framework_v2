// Pruebas UNITARIAS de la orquestación (deduplicación, concurrencia, cuota, degradación) con almacén y proveedor simulados.
import { describe, expect, it, vi } from 'vitest'
import { importSeason, searchCompetitions, syncDue, type CatalogStore, type SyncDeps } from '../../../../supabase/functions/_shared/sports/sync.ts'
import { ProviderError, type ProviderFixture, type SportsProvider } from '../../../../supabase/functions/_shared/sports/types.ts'

function fixture(id: string): ProviderFixture {
  return { external_id: id, round: 'Regular Season - 1', home: { external_id: '1', name: 'A', national: false }, away: { external_id: '2', name: 'B', national: false },
    starts_at: '2026-10-20T20:00:00.000Z', provider_status: 'NS', state: 'scheduled', home_goals: null, away_goals: null, provider_updated_at: null }
}

// Almacén en memoria que replica la semántica de catalog_begin_import (un solo "running" por recurso; "fresh" tras éxito).
function makeStore(overrides: Partial<CatalogStore> = {}, opts: { quota?: number } = {}) {
  const running = new Set<string>(); const done = new Set<string>(); let remaining = opts.quota ?? 100
  const calls = { finish: [] as unknown[][], consume: [] as number[], outcome: [] as unknown[][], propagated: [] as string[][], upserts: 0 }
  const store: CatalogStore = {
    async beginImport(key) {
      await Promise.resolve()
      if (running.has(key)) return { outcome: 'in_progress', jobId: 'j-existing' }
      if (done.has(key)) return { outcome: 'fresh', jobId: 'j-old' }
      running.add(key); return { outcome: 'started', jobId: `job:${key}` }
    },
    async finishImport(jobId, status, code, requests) { calls.finish.push([jobId, status, code, requests]); running.delete(jobId.replace('job:', '')); if (status === 'succeeded') done.add(jobId.replace('job:', '')) },
    async consume(n, limit) { calls.consume.push(limit); if (remaining < n) return -1; remaining -= n; return remaining },
    async recordOutcome(error, rateLimited) { calls.outcome.push([error, rateLimited]) },
    async upsertCompetition() { calls.upserts++ },
    async findSeason() { return 'season-1' },
    async upsertFixtures(_season, fixtures) { return fixtures.map((f) => `id-${f.external_id}`) },
    async propagate(ids) { calls.propagated.push(ids); return { matches: ids.length } },
    async dueFixtures() { return [] },
    ...overrides,
  }
  return { store, calls }
}
function deps(store: CatalogStore, provider: Partial<SportsProvider> = {}, extra: Partial<SyncDeps> = {}): SyncDeps {
  return { store, dailyLimit: 100, syncReserve: 10, provider: (gate) => ({
    id: 'fake', maxIdsPerRequest: 20, supportsIdsLookup: true, getLiveFixtures: async () => { await gate(); return [] },
    searchCompetitions: async () => { await gate(); return [] },
    getCompetition: async () => null,
    getSeasonFixtures: async () => { await gate(); return [fixture('1'), fixture('2')] },
    getFixturesByIds: async (ids) => { await gate(); return ids.map(fixture) },
    ...provider }), ...extra }
}

describe('importación bajo demanda', () => {
  it('importa una temporada: 1 solicitud, guarda y propaga solo lo cambiado', async () => {
    const { store, calls } = makeStore()
    const result = await importSeason(deps(store), 'u1', '39', 2023)
    expect(result).toMatchObject({ status: 'ok', requests_used: 1, detail: { fixtures: 2, changed: 2 } })
    expect(calls.propagated).toEqual([['id-1', 'id-2']])
  })

  it('una segunda solicitud posterior es "fresh": no llama al proveedor ni gasta cuota', async () => {
    const { store, calls } = makeStore()
    const getSeasonFixtures = vi.fn(async () => [fixture('1')])
    const d = deps(store, { getSeasonFixtures })
    await importSeason(d, 'u1', '39', 2023)
    const again = await importSeason(d, 'u2', '39', 2023)
    expect(again).toEqual({ status: 'fresh', requests_used: 0 })
    expect(getSeasonFixtures).toHaveBeenCalledTimes(1)
    expect(calls.consume).toHaveLength(0)
  })

  it('varios organizadores simultáneos: el recurso se importa UNA sola vez', async () => {
    const { store } = makeStore()
    const getSeasonFixtures = vi.fn(async () => { await new Promise((r) => setTimeout(r, 15)); return [fixture('1')] })
    const d = deps(store, { getSeasonFixtures })
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => importSeason(d, `u${i}`, '39', 2023)))
    expect(getSeasonFixtures).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.status === 'ok')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'in_progress')).toHaveLength(7)
  })

  it('temporada inexistente: error controlado y sin escribir fixtures', async () => {
    const { store, calls } = makeStore({ findSeason: async () => null })
    const d = deps(store, { getCompetition: async () => ({ external_id: '39', name: 'PL', kind: 'league', country_name: null, country_code: null, seasons: [{ year: 2020, start: null, end: null, current: false }] }) })
    const result = await importSeason(d, 'u1', '39', 2023)
    expect(result).toMatchObject({ status: 'degraded', code: 'BAD_REQUEST' })
    expect(calls.finish[0]?.slice(1, 3)).toEqual(['failed', 'BAD_REQUEST'])
  })

  it('rechaza entradas inválidas sin tocar proveedor ni cuota', async () => {
    const { store, calls } = makeStore()
    const spy = vi.fn()
    const d = deps(store, { getSeasonFixtures: spy })
    for (const [id, year] of [['39;x', 2023], ['39', 1800], ['', 2023]] as const) expect(await importSeason(d, 'u', id, year)).toMatchObject({ status: 'degraded', code: 'BAD_REQUEST' })
    expect(await searchCompetitions(d, 'u', 'ab')).toMatchObject({ code: 'BAD_REQUEST' })
    expect(spy).not.toHaveBeenCalled(); expect(calls.consume).toHaveLength(0)
  })
})

describe('cuota diaria y degradación', () => {
  it('sin cuota: degradación controlada "QUOTA_EXHAUSTED" y no se llama al proveedor HTTP', async () => {
    const { store, calls } = makeStore({}, { quota: 0 })
    const http = vi.fn()
    const provider = (gate: () => Promise<boolean>) => ({ id: 'f', maxIdsPerRequest: 20, supportsIdsLookup: true, getLiveFixtures: async () => [], searchCompetitions: async () => [], getCompetition: async () => null,
      getFixturesByIds: async () => [], getSeasonFixtures: async () => { if (!(await gate())) throw new ProviderError('QUOTA_EXHAUSTED'); http(); return [] } })
    const result = await importSeason({ store, provider, dailyLimit: 100, syncReserve: 10 }, 'u', '39', 2023)
    expect(result).toMatchObject({ status: 'degraded', code: 'QUOTA_EXHAUSTED' })
    expect(http).not.toHaveBeenCalled()
    expect(calls.finish[0]?.slice(1, 3)).toEqual(['rate_limited', 'QUOTA_EXHAUSTED'])
  })

  it('las acciones interactivas dejan una reserva para el sondeo de partidos activos', async () => {
    const { store, calls } = makeStore()
    await importSeason(deps(store), 'u', '39', 2023)
    await syncDue(deps(store), null)
    expect(calls.consume[0]).toBe(90) // interactivo: 100 - 10
  })

  it('el sondeo usa el límite completo', async () => {
    const { store, calls } = makeStore({ dueFixtures: async () => [{ external_id: '5', season_id: 's1' }] })
    await syncDue(deps(store), null)
    expect(calls.consume).toEqual([100])
  })

  it('429 persistente → rate_limited y se registra el 429; fallo 5xx → failed', async () => {
    const a = makeStore()
    expect(await importSeason(deps(a.store, { getSeasonFixtures: async () => { throw new ProviderError('RATE_LIMITED') } }), 'u', '39', 2023)).toMatchObject({ status: 'degraded', code: 'RATE_LIMITED' })
    expect(a.calls.outcome).toEqual([[false, true]]); expect(a.calls.finish[0]?.[1]).toBe('rate_limited')
    const b = makeStore()
    expect(await importSeason(deps(b.store, { getSeasonFixtures: async () => { throw new ProviderError('UPSTREAM') } }), 'u', '39', 2023)).toMatchObject({ code: 'UPSTREAM' })
    expect(b.calls.outcome).toEqual([[true, false]]); expect(b.calls.finish[0]?.[1]).toBe('failed')
  })

  it('un error no controlado libera el trabajo (no queda "running") y se propaga', async () => {
    const { store, calls } = makeStore()
    await expect(importSeason(deps(store, { getSeasonFixtures: async () => { throw new Error('boom') } }), 'u', '39', 2023)).rejects.toThrow('boom')
    expect(calls.finish[0]?.[1]).toBe('failed')
  })
})

describe('sondeo adaptativo de partidos activos', () => {
  it('agrupa en lotes de 20 ids (45 partidos = 3 solicitudes) y guarda/propaga por lote', async () => {
    const due = Array.from({ length: 45 }, (_, i) => ({ external_id: String(i + 1), season_id: i < 30 ? 's1' : 's2' }))
    const { store, calls } = makeStore({ dueFixtures: async () => due })
    const getFixturesByIds = vi.fn(async (ids: string[]) => ids.map(fixture))
    const result = await syncDue(deps(store, { getFixturesByIds }), null)
    expect(getFixturesByIds.mock.calls.map((c) => c[0].length)).toEqual([20, 20, 5])
    expect(result).toMatchObject({ status: 'ok', detail: { polled: 45, changed: 45 } })
    expect(calls.propagated.flat()).toHaveLength(45)
  })

  it('plan gratuito: una sola solicitud live=all filtrada a los partidos seguidos', async () => {
    const due = [{ external_id: '7', season_id: 's1' }, { external_id: '8', season_id: 's1' }]
    const { store, calls } = makeStore({ dueFixtures: async () => due })
    const getLiveFixtures = vi.fn(async () => [fixture('7'), fixture('999'), fixture('1000')])
    const getFixturesByIds = vi.fn()
    const upserts: string[][] = []
    store.upsertFixtures = async (_s, rows) => { upserts.push(rows.map((r) => r.external_id)); return rows.map((r) => `id-${r.external_id}`) }
    const result = await syncDue(deps(store, { supportsIdsLookup: false, getLiveFixtures, getFixturesByIds }), null)
    expect(result).toMatchObject({ status: 'ok', detail: { mode: 'live_only', changed: 1 } })
    expect(getLiveFixtures).toHaveBeenCalledTimes(1); expect(getFixturesByIds).not.toHaveBeenCalled()
    expect(upserts).toEqual([['7']]) // los partidos ajenos que el proveedor devuelve NO se almacenan
    expect(calls.propagated).toEqual([['id-7']])
  })

  it('sin partidos pendientes no consume cuota', async () => {
    const { store, calls } = makeStore()
    const result = await syncDue(deps(store), 'u')
    expect(result).toMatchObject({ status: 'ok', requests_used: 0, detail: { polled: 0 } })
    expect(calls.consume).toHaveLength(0)
  })

  it('si un lote posterior falla, lo ya propagado se conserva', async () => {
    const due = Array.from({ length: 25 }, (_, i) => ({ external_id: String(i + 1), season_id: 's1' }))
    const { store, calls } = makeStore({ dueFixtures: async () => due })
    let n = 0
    const result = await syncDue(deps(store, { getFixturesByIds: async (ids) => { if (++n === 2) throw new ProviderError('RATE_LIMITED'); return ids.map(fixture) } }), null)
    expect(result).toMatchObject({ status: 'degraded', code: 'RATE_LIMITED' })
    expect(calls.propagated.flat()).toHaveLength(20)
  })

  it('un segundo sondeo inmediato es "fresh" (dos administradores no duplican el trabajo)', async () => {
    const { store } = makeStore({ dueFixtures: async () => [{ external_id: '1', season_id: 's' }] })
    const d = deps(store)
    expect((await syncDue(d, 'a')).status).toBe('ok')
    expect((await syncDue(d, 'b')).status).toBe('fresh')
  })
})

describe('búsqueda de competiciones', () => {
  it('guarda lo encontrado y repite como fresh sin gastar cuota', async () => {
    const { store, calls } = makeStore()
    const d = deps(store, { searchCompetitions: async () => [{ external_id: '39', name: 'PL', kind: 'league', country_name: null, country_code: null, seasons: [] }] })
    expect(await searchCompetitions(d, 'u', ' Premier  League ')).toMatchObject({ status: 'ok', detail: { competitions: 1 } })
    expect((await searchCompetitions(d, 'u', 'premier league')).status).toBe('fresh')
    expect(calls.upserts).toBe(1)
  })
})
