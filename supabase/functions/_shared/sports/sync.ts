import { ProviderError, type ProviderCompetition, type ProviderFixture, type RequestGate, type SportsProvider } from './types.ts'

// Orquestación de importación/sincronización (ADR-016). Sin dependencias de Deno ni de Supabase: el almacén (`CatalogStore`) y el
// proveedor se inyectan, de modo que la lógica (deduplicación, cuota, degradación) se prueba con dobles.
export type ImportOutcome = 'started' | 'in_progress' | 'fresh'
export type PropagationCounters = Record<string, number>

export interface CatalogStore {
  beginImport(resourceKey: string, requestedBy: string | null, freshForSeconds: number): Promise<{ outcome: ImportOutcome; jobId: string }>
  finishImport(jobId: string, status: 'succeeded' | 'failed' | 'rate_limited', errorCode: string | null, requests: number): Promise<void>
  // Reserva `n` solicitudes del día bajo `limit`. Devuelve las que quedan o -1 si no hay cuota.
  consume(n: number, limit: number): Promise<number>
  recordOutcome(error: boolean, rateLimited: boolean): Promise<void>
  upsertCompetition(competition: ProviderCompetition): Promise<void>
  findSeason(competitionExternalId: string, year: number): Promise<string | null>
  upsertFixtures(seasonId: string, fixtures: ProviderFixture[]): Promise<string[]>
  propagate(fixtureIds: string[]): Promise<PropagationCounters>
  dueFixtures(limit: number): Promise<{ external_id: string; season_id: string }[]>
}

export type SyncDeps = {
  store: CatalogStore
  // Fábrica: recibe la compuerta de cuota de ESTA operación para que cada intento HTTP quede contado y limitado.
  provider: (gate: RequestGate) => SportsProvider
  dailyLimit: number
  // Margen reservado al sondeo de partidos activos: las acciones interactivas no pueden agotarlo.
  syncReserve: number
}

export type OperationResult = {
  status: 'ok' | 'fresh' | 'in_progress' | 'degraded'
  code?: string
  requests_used: number
  detail?: Record<string, unknown>
}

function metered(store: CatalogStore, limit: number) {
  let used = 0
  const gate: RequestGate = async () => {
    if ((await store.consume(1, limit)) < 0) return false
    used += 1
    return true
  }
  return { gate, used: () => used }
}

async function guarded(
  deps: SyncDeps,
  key: string,
  requestedBy: string | null,
  freshForSeconds: number,
  limit: number,
  work: (provider: SportsProvider) => Promise<Record<string, unknown>>,
): Promise<OperationResult> {
  const { outcome, jobId } = await deps.store.beginImport(key, requestedBy, freshForSeconds)
  // Importación ya hecha o en curso por otra solicitud: no se consulta al proveedor ni se gasta cuota.
  if (outcome !== 'started') return { status: outcome, requests_used: 0 }
  const meter = metered(deps.store, limit)
  try {
    const detail = await work(deps.provider(meter.gate))
    await deps.store.finishImport(jobId, 'succeeded', null, meter.used())
    return { status: 'ok', requests_used: meter.used(), detail }
  } catch (error) {
    const code = error instanceof ProviderError ? error.code : 'INTERNAL'
    const limited = code === 'RATE_LIMITED' || code === 'QUOTA_EXHAUSTED'
    await deps.store.finishImport(jobId, limited ? 'rate_limited' : 'failed', code, meter.used()).catch(() => undefined)
    await deps.store.recordOutcome(!limited, code === 'RATE_LIMITED').catch(() => undefined)
    if (!(error instanceof ProviderError)) throw error
    // Degradación controlada: el catálogo ya guardado sigue sirviéndose; el cliente recibe el motivo.
    return { status: 'degraded', code, requests_used: meter.used() }
  }
}

const SEARCH_FRESH_SECONDS = 24 * 3600
const SEASON_FRESH_SECONDS = 6 * 3600
const SYNC_FRESH_SECONDS = 120

export function searchCompetitions(deps: SyncDeps, userId: string, query: string): Promise<OperationResult> {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (q.length < 3 || q.length > 60) return Promise.resolve({ status: 'degraded', code: 'BAD_REQUEST', requests_used: 0 })
  return guarded(deps, `search:${q}`, userId, SEARCH_FRESH_SECONDS, deps.dailyLimit - deps.syncReserve, async (provider) => {
    const found = await provider.searchCompetitions(q)
    for (const competition of found) await deps.store.upsertCompetition(competition)
    return { competitions: found.length }
  })
}

export function importSeason(deps: SyncDeps, userId: string, competitionExternalId: string, year: number): Promise<OperationResult> {
  if (!/^[0-9]{1,9}$/.test(competitionExternalId) || !Number.isInteger(year) || year < 1990 || year > 2100) {
    return Promise.resolve({ status: 'degraded', code: 'BAD_REQUEST', requests_used: 0 })
  }
  return guarded(deps, `season:${competitionExternalId}:${year}`, userId, SEASON_FRESH_SECONDS, deps.dailyLimit - deps.syncReserve, async (provider) => {
    let seasonId = await deps.store.findSeason(competitionExternalId, year)
    if (!seasonId) {
      const competition = await provider.getCompetition(competitionExternalId)
      if (!competition || !competition.seasons.some((season) => season.year === year)) throw new ProviderError('BAD_REQUEST', 'SEASON_NOT_AVAILABLE')
      await deps.store.upsertCompetition(competition)
      seasonId = await deps.store.findSeason(competitionExternalId, year)
      if (!seasonId) throw new ProviderError('BAD_RESPONSE')
    }
    const fixtures = await provider.getSeasonFixtures(competitionExternalId, year)
    const changed = await deps.store.upsertFixtures(seasonId, fixtures)
    // Una reimportación puede traer cambios de partidos ya vinculados a tenants: se propagan solo los cambiados.
    const propagated = changed.length ? await deps.store.propagate(changed) : {}
    return { season_id: seasonId, fixtures: fixtures.length, changed: changed.length, propagated }
  })
}

// Sondeo adaptativo de los partidos que algun tenant usa (la cola decide que toca ahora segun su cercania).
// Plan de pago: lotes de hasta 20 ids. Plan gratuito: una sola solicitud `live=all` filtrada a los partidos seguidos (los resultados
// finales de temporadas en curso NO son accesibles en ese plan: el organizador los confirma manualmente, ADR-012).
export function syncDue(deps: SyncDeps, userId: string | null): Promise<OperationResult> {
  return guarded(deps, 'sync:due', userId, SYNC_FRESH_SECONDS, deps.dailyLimit, async (provider) => {
    const due = await deps.store.dueFixtures(100)
    if (!due.length) return { polled: 0, changed: 0 }
    const seasonOf = new Map(due.map((row) => [row.external_id, row.season_id]))
    let polled = 0
    let changedTotal = 0
    // Cada lote se guarda y propaga de inmediato: si un lote posterior falla (429/cuota), lo ya obtenido no se pierde.
    const store = async (fixtures: ProviderFixture[]) => {
      const bySeason = new Map<string, ProviderFixture[]>()
      for (const fixture of fixtures) {
        const season = seasonOf.get(fixture.external_id)
        if (season) bySeason.set(season, [...(bySeason.get(season) ?? []), fixture])
      }
      const changed: string[] = []
      for (const [season, rows] of bySeason) changed.push(...(await deps.store.upsertFixtures(season, rows)))
      if (changed.length) await deps.store.propagate(changed)
      changedTotal += changed.length
    }
    if (provider.supportsIdsLookup) {
      const size = provider.maxIdsPerRequest
      for (let i = 0; i < due.length; i += size) {
        const batch = due.slice(i, i + size).map((row) => row.external_id)
        await store(await provider.getFixturesByIds(batch))
        polled += batch.length
      }
      return { polled, changed: changedTotal, mode: 'ids' }
    }
    await store(await provider.getLiveFixtures())
    return { polled: due.length, changed: changedTotal, mode: 'live_only' }
  })
}
