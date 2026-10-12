import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

import { createApiFootballProvider } from '../_shared/sports/api-football.ts'
import {
  importSeason,
  searchCompetitions,
  syncDue,
  type CatalogStore,
  type ImportOutcome,
  type OperationResult,
  type PropagationCounters,
  type SyncDeps,
} from '../_shared/sports/sync.ts'
import type { ProviderCompetition, ProviderFixture } from '../_shared/sports/types.ts'

// ADR-016. ÚNICO punto que habla con el proveedor deportivo. Acciones (POST JSON):
//   { action: 'search', query }                      · administrador de algún tenant (JWT de usuario)
//   { action: 'import_season', competition, year }   · administrador de algún tenant
//   { action: 'sync' }                               · administrador de algún tenant (bajo demanda) o x-sync-secret (programado)
// La clave del proveedor vive solo en secretos de la función; jamás se devuelve ni se registra. Sin clave → degradación NOT_CONFIGURED.
const PROVIDER = 'api_football'
const SYNC_RESERVE = 10

const encoder = new TextEncoder()

function env(name: string): string | undefined {
  return Deno.env.get(name) || undefined
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin')
  const allowed = (env('CORS_ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean)
  if (!origin || !allowed.includes(origin)) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, content-type, x-client-info, apikey',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(a)), crypto.subtle.digest('SHA-256', encoder.encode(b))])
  const left = new Uint8Array(x)
  const right = new Uint8Array(y)
  let diff = 0
  for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!
  return diff === 0
}

type Db = SupabaseClient

function createStore(db: Db): CatalogStore {
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw new Error(`rpc ${fn} failed`)
    return data as T
  }
  return {
    async beginImport(resourceKey, requestedBy, freshForSeconds) {
      const rows = await rpc<{ outcome: ImportOutcome; job_id: string }[]>('catalog_begin_import', {
        p_provider: PROVIDER, p_resource_key: resourceKey, p_requested_by: requestedBy, p_fresh_for: `${freshForSeconds} seconds`,
      })
      const row = rows[0]
      if (!row) throw new Error('begin import returned nothing')
      return { outcome: row.outcome, jobId: row.job_id }
    },
    async finishImport(jobId, status, errorCode, requests) {
      await rpc('catalog_finish_import', { p_job_id: jobId, p_status: status, p_error_code: errorCode, p_requests: requests })
    },
    async consume(n, limit) {
      return await rpc<number>('provider_consume', { p_provider: PROVIDER, p_daily_limit: limit, p_n: n })
    },
    async recordOutcome(isError, rateLimited) {
      await rpc('provider_record_outcome', { p_provider: PROVIDER, p_error: isError, p_rate_limited: rateLimited })
    },
    async upsertCompetition(competition: ProviderCompetition) {
      await rpc('catalog_upsert_competition', { p_provider: PROVIDER, p_payload: competition })
    },
    async findSeason(competitionExternalId, year) {
      const { data: competition } = await db.from('catalog_competitions').select('id').eq('provider', PROVIDER).eq('external_id', competitionExternalId).maybeSingle()
      if (!competition) return null
      const { data: season } = await db.from('catalog_seasons').select('id').eq('competition_id', competition.id).eq('year', year).maybeSingle()
      return season?.id ?? null
    },
    async upsertFixtures(seasonId, fixtures: ProviderFixture[]) {
      return await rpc<string[]>('catalog_upsert_fixtures', { p_season_id: seasonId, p_provider: PROVIDER, p_fixtures: fixtures })
    },
    async propagate(fixtureIds) {
      return await rpc<PropagationCounters>('catalog_propagate_fixtures', { p_fixture_ids: fixtureIds })
    },
    async dueFixtures(limit) {
      return await rpc<{ external_id: string; season_id: string }[]>('catalog_fixtures_due', { p_provider: PROVIDER, p_limit: limit })
    },
  }
}

function dailyLimit(): number {
  const configured = Number(env('API_FOOTBALL_DAILY_LIMIT'))
  return Number.isInteger(configured) && configured >= 20 && configured <= 100_000 ? configured : 100 // plan gratuito por defecto
}

// Identifica al usuario por su JWT y exige membresía administrativa activa en ALGÚN tenant (las acciones alimentan el catálogo global; la
// autorización de lo que se copia a cada tenant la hace import_catalog_round dentro de la base de datos).
async function authorizeAdmin(request: Request): Promise<string | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const url = env('SUPABASE_URL')
  const anon = env('SUPABASE_ANON_KEY')
  if (!token || !url || !anon) return null
  const userClient = createClient(url, anon, { global: { headers: { authorization: `Bearer ${token}` } }, auth: { autoRefreshToken: false, persistSession: false } })
  const { data: userData, error } = await userClient.auth.getUser(token)
  if (error || !userData.user) return null
  const { data: memberships, error: memberError } = await userClient.from('tenant_memberships').select('tenant_id').in('role', ['owner', 'admin']).eq('is_active', true).limit(1)
  if (memberError || !memberships?.length) return null
  return userData.user.id
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID()
  const cors = corsHeaders(request)
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405, cors)
    if (request.headers.get('origin') && !Object.keys(cors).length) return json({ code: 'FORBIDDEN' }, 403)

    let body: { action?: string; query?: string; competition?: string; year?: number }
    try { body = await request.json() } catch { return json({ code: 'BAD_REQUEST' }, 400, cors) }

    const secret = env('SPORTS_SYNC_SECRET')
    const received = request.headers.get('x-sync-secret')
    const scheduled = Boolean(secret && received && (await constantTimeEqual(secret, received)))
    const userId = scheduled ? null : await authorizeAdmin(request)
    if (!scheduled && !userId) return json({ code: 'UNAUTHORIZED' }, 401, cors)
    if (scheduled && body.action !== 'sync') return json({ code: 'FORBIDDEN' }, 403, cors)

    const url = env('SUPABASE_URL')
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) return json({ code: 'INTERNAL_ERROR' }, 500, cors)
    const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const apiKey = env('API_FOOTBALL_KEY')
    const deps: SyncDeps = {
      store: createStore(db),
      dailyLimit: dailyLimit(),
      syncReserve: SYNC_RESERVE,
      provider: (gate) => createApiFootballProvider({ apiKey, gate, plan: env('API_FOOTBALL_PLAN') === 'paid' ? 'paid' : 'free' }),
    }

    let result: OperationResult
    switch (body.action) {
      case 'search': result = await searchCompetitions(deps, userId ?? 'scheduled', String(body.query ?? '')); break
      case 'import_season': result = await importSeason(deps, userId ?? 'scheduled', String(body.competition ?? ''), Number(body.year)); break
      case 'sync': result = await syncDue(deps, userId); break
      default: return json({ code: 'BAD_REQUEST' }, 400, cors)
    }
    // Registro mínimo: sin clave, sin JWT, sin datos personales.
    console.log(JSON.stringify({ request_id: requestId, action: body.action, status: result.status, code: result.code, requests_used: result.requests_used }))
    return json({ ...result, request_id: requestId }, 200, cors)
  } catch {
    console.log(JSON.stringify({ request_id: requestId, status: 'error' }))
    return json({ code: 'INTERNAL_ERROR', request_id: requestId }, 500, cors)
  }
})
