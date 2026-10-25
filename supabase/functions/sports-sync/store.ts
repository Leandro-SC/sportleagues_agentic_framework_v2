import type {
  CatalogStore,
  ImportOutcome,
  PropagationCounters,
} from '../_shared/sports/sync.ts'
import type { ProviderCompetition, ProviderFixture } from '../_shared/sports/types.ts'
import type { Operation } from '../_shared/sports/access.ts'

// ADR-021. Almacén de catálogo sobre RPC de la base de datos (cliente service_role). La reserva de cuota ya NO usa el consumo diario heredado (sin tope por tenant):
// pasa por `provider_reserve` (presupuesto global + por tenant/plan, atómico) y cada reserva se liquida al terminar la operación.
// Contrato mínimo del cliente para poder probar el almacén con un doble (SupabaseClient lo satisface estructuralmente).
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
  // deno-lint-ignore no-explicit-any
  from(table: string): any
}

export type StoreContext = {
  provider: string
  kind: Operation
  // Atribución contable informada por el proceso backend de confianza (nunca autoriza datos del tenant). Nulo = ámbito plataforma.
  tenantId: string | null
}

export type QuotaStore = CatalogStore & {
  // Comprobación previa sin consumir: 'OK' o el motivo de rechazo (plan, bandera, tenant, proveedor).
  checkAccess(): Promise<string>
  // Motivo de la última reserva rechazada en esta operación (para informar al proceso llamador), o null.
  denial(): string | null
}

export function createCatalogStore(db: RpcClient, ctx: StoreContext): QuotaStore {
  const reservations: string[] = []
  let lastDenial: string | null = null

  // Los errores de RPC NO se propagan con su mensaje (podría contener detalles internos): solo el nombre de la función.
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw new Error(`rpc ${fn} failed`)
    return data as T
  }

  return {
    async checkAccess() {
      const reason = await rpc<string | null>('provider_access_check', { p_provider: ctx.provider, p_kind: ctx.kind, p_tenant: ctx.tenantId })
      return typeof reason === 'string' ? reason : 'FORBIDDEN'
    },
    denial: () => lastDenial,
    async beginImport(resourceKey, requestedBy, freshForSeconds) {
      const rows = await rpc<{ outcome: ImportOutcome; job_id: string }[]>('catalog_begin_import', {
        p_provider: ctx.provider, p_resource_key: resourceKey, p_requested_by: requestedBy, p_fresh_for: `${freshForSeconds} seconds`,
      })
      const row = rows[0]
      if (!row) throw new Error('begin import returned nothing')
      return { outcome: row.outcome, jobId: row.job_id }
    },
    async finishImport(jobId, status, errorCode, requests) {
      await rpc('catalog_finish_import', { p_job_id: jobId, p_status: status, p_error_code: errorCode, p_requests: requests })
    },
    // Reserva ANTES de cada intento HTTP. `limit` solo puede restar presupuesto (p_daily_cap); la base de datos manda.
    async consume(n, limit) {
      const rows = await rpc<{ allowed: boolean; reason: string | null; reservation_id: string | null; global_remaining: number | null }[]>('provider_reserve', {
        p_provider: ctx.provider, p_kind: ctx.kind, p_tenant: ctx.tenantId, p_n: n, p_daily_cap: limit,
      })
      const row = rows?.[0]
      if (!row || row.allowed !== true || !row.reservation_id) {
        lastDenial = row?.reason ?? 'FORBIDDEN'
        return -1
      }
      reservations.push(row.reservation_id)
      return row.global_remaining ?? 0
    },
    async recordOutcome(isError, rateLimited) {
      await rpc('provider_record_outcome', { p_provider: ctx.provider, p_error: isError, p_rate_limited: rateLimited })
    },
    // Criterio (ADR-021 §Liquidación): todo intento que salió cuenta; NUNCA se libera tras un intento HTTP emitido (el proveedor puede haberlo
    // contado aunque respondiera 429/5xx). Con éxito → consumed; con error → failed con el código corto. QUOTA_EXHAUSTED significa que el
    // intento NO emitido fue el último (los anteriores sí salieron) → consumed. Si liquidar falla, la reserva sigue contando y la purga la
    // marca UNSETTLED: el error siempre cae del lado conservador.
    async settleReservations(outcome, errorCode) {
      const settled = outcome === 'succeeded' || errorCode === 'QUOTA_EXHAUSTED' ? 'consumed' : 'failed'
      const pending = reservations.splice(0)
      for (const id of pending) {
        await rpc('provider_settle', { p_reservation_id: id, p_outcome: settled, p_error_code: settled === 'failed' ? errorCode : null }).catch(() => undefined)
      }
    },
    async upsertCompetition(competition: ProviderCompetition) {
      await rpc('catalog_upsert_competition', { p_provider: ctx.provider, p_payload: competition })
    },
    async findSeason(competitionExternalId, year) {
      const { data: competition } = await db.from('catalog_competitions').select('id').eq('provider', ctx.provider).eq('external_id', competitionExternalId).maybeSingle()
      if (!competition) return null
      const { data: season } = await db.from('catalog_seasons').select('id').eq('competition_id', competition.id).eq('year', year).maybeSingle()
      return season?.id ?? null
    },
    async upsertFixtures(seasonId, fixtures: ProviderFixture[]) {
      return await rpc<string[]>('catalog_upsert_fixtures', { p_season_id: seasonId, p_provider: ctx.provider, p_fixtures: fixtures })
    },
    async propagate(fixtureIds) {
      return await rpc<PropagationCounters>('catalog_propagate_fixtures', { p_fixture_ids: fixtureIds })
    },
    async dueFixtures(limit) {
      return await rpc<{ external_id: string; season_id: string }[]>('catalog_fixtures_due', { p_provider: ctx.provider, p_limit: limit })
    },
  }
}
