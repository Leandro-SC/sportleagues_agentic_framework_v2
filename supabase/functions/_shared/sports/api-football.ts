import { assertNoProviderErrors, normalizeCompetition, normalizeFixture } from './mapping.ts'
import { ProviderError, type ProviderCompetition, type ProviderFixture, type RequestGate, type SportsProvider } from './types.ts'

export type ApiFootballOptions = {
  apiKey: string | undefined
  fetchImpl?: typeof fetch
  baseUrl?: string
  gate?: RequestGate
  maxRetries?: number
  // Espera entre reintentos (inyectable para pruebas). Backoff exponencial acotado.
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  // 'free' (por defecto): sin `ids`; 'paid': sondeo por lotes de ids.
  plan?: 'free' | 'paid'
  onAttempt?: (info: { path: string; attempt: number; status: number | 'network' }) => void
}

const BASE = 'https://v3.football.api-sports.io'
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Proveedor inicial (ADR-016). Cada intento HTTP reserva cuota ANTES de salir; solo 429/5xx/red se reintentan, con tope.
// Jamás registra ni devuelve la clave.
export function createApiFootballProvider(options: ApiFootballOptions): SportsProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const base = options.baseUrl ?? BASE
  const maxRetries = Math.min(Math.max(options.maxRetries ?? 2, 0), 3)
  const sleep = options.sleep ?? defaultSleep

  async function once(url: string, apiKey: string): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
    try {
      return await fetchImpl(url, { headers: { 'x-apisports-key': apiKey, accept: 'application/json' }, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  async function call(path: string, params: Record<string, string | number>): Promise<unknown[]> {
    const apiKey = options.apiKey
    if (!apiKey) throw new ProviderError('NOT_CONFIGURED')
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)])).toString()
    const url = `${base}${path}?${query}`
    let last = new ProviderError('UPSTREAM')
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (options.gate && !(await options.gate())) throw new ProviderError('QUOTA_EXHAUSTED')
      let response: Response
      try {
        response = await once(url, apiKey)
      } catch {
        options.onAttempt?.({ path, attempt, status: 'network' })
        last = new ProviderError('UPSTREAM')
        if (attempt < maxRetries) { await sleep(500 * 2 ** attempt); continue }
        throw last
      }
      options.onAttempt?.({ path, attempt, status: response.status })
      if (response.status === 401 || response.status === 403) throw new ProviderError('AUTH')
      if (response.status === 429) {
        last = new ProviderError('RATE_LIMITED')
        if (attempt < maxRetries) {
          const retryAfter = Number(response.headers.get('retry-after'))
          await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 1000 * 2 ** attempt)
          continue
        }
        throw last
      }
      if (response.status >= 500) {
        last = new ProviderError('UPSTREAM')
        if (attempt < maxRetries) { await sleep(500 * 2 ** attempt); continue }
        throw last
      }
      if (!response.ok) throw new ProviderError('BAD_REQUEST')
      let body: unknown
      try { body = await response.json() } catch { throw new ProviderError('BAD_RESPONSE') }
      try {
        assertNoProviderErrors(body)
      } catch (error) {
        // `errors.rateLimit` llega con HTTP 200: se trata igual que un 429 (reintento acotado).
        if (error instanceof ProviderError && error.code === 'RATE_LIMITED' && attempt < maxRetries) {
          last = error
          await sleep(1000 * 2 ** attempt)
          continue
        }
        throw error
      }
      const payload = (body as { response?: unknown }).response
      if (!Array.isArray(payload)) throw new ProviderError('BAD_RESPONSE')
      return payload
    }
    throw last
  }

  const fixtures = (rows: unknown[]): ProviderFixture[] => rows.map(normalizeFixture).filter((row): row is ProviderFixture => row !== null)
  const competitions = (rows: unknown[]): ProviderCompetition[] => rows.map(normalizeCompetition).filter((row): row is ProviderCompetition => row !== null)

  return {
    id: 'api_football',
    maxIdsPerRequest: 20,
    supportsIdsLookup: options.plan === 'paid',
    async searchCompetitions(query) {
      const q = query.trim()
      if (q.length < 3) throw new ProviderError('BAD_REQUEST')
      return competitions(await call('/leagues', { search: q }))
    },
    async getCompetition(externalId) {
      return competitions(await call('/leagues', { id: externalId }))[0] ?? null
    },
    async getSeasonFixtures(competitionExternalId, year) {
      return fixtures(await call('/fixtures', { league: competitionExternalId, season: year }))
    },
    async getLiveFixtures() {
      return fixtures(await call('/fixtures', { live: 'all' }))
    },
    async getFixturesByIds(ids) {
      if (options.plan !== 'paid') throw new ProviderError('PLAN_RESTRICTED')
      const unique = [...new Set(ids)].filter((id) => /^[0-9]+$/.test(id))
      if (!unique.length) return []
      if (unique.length > 20) throw new ProviderError('BAD_REQUEST')
      return fixtures(await call('/fixtures', { ids: unique.join('-') }))
    },
  }
}
