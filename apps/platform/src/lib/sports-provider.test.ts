// Pruebas UNITARIAS del adaptador de proveedor (ADR-016) con respuestas SIMULADAS que replican la forma real de API-Football.
// No son una integración externa verificada: la sonda real vive en scripts/qa/provider-probe.mjs.
import { describe, expect, it, vi } from 'vitest'
import { createApiFootballProvider } from '../../../../supabase/functions/_shared/sports/api-football.ts'
import { mapFixtureState, normalizeCompetition, normalizeFixture } from '../../../../supabase/functions/_shared/sports/mapping.ts'
import { ProviderError } from '../../../../supabase/functions/_shared/sports/types.ts'

function raw(id: number, short: string, fulltime: [number | null, number | null] = [null, null], goals: [number | null, number | null] = [null, null]) {
  return {
    fixture: { id, date: '2023-08-11T19:00:00+00:00', status: { short, long: 'x' } },
    league: { id: 39, round: 'Regular Season - 1', logo: 'https://media.example/l.png' },
    teams: { home: { id: 44, name: 'Burnley', logo: 'https://media.example/44.png' }, away: { id: 50, name: 'Manchester City', logo: 'https://media.example/50.png' } },
    goals: { home: goals[0], away: goals[1] },
    score: { fulltime: { home: fulltime[0], away: fulltime[1] }, extratime: { home: null, away: null } },
  }
}
const ok = (response: unknown[]) => new Response(JSON.stringify({ errors: [], response }), { status: 200 })
const noSleep = async () => undefined

describe('mapeo de estados y normalización', () => {
  it('mapea estados del proveedor a estados internos', () => {
    for (const s of ['NS', 'TBD', 'DESCONOCIDO']) expect(mapFixtureState(s)).toBe('scheduled')
    for (const s of ['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']) expect(mapFixtureState(s)).toBe('live')
    for (const s of ['FT', 'AET', 'PEN', 'AWD', 'WO']) expect(mapFixtureState(s)).toBe('final')
    expect(mapFixtureState('PST')).toBe('postponed')
    expect(mapFixtureState('CANC')).toBe('cancelled')
    expect(mapFixtureState('ABD')).toBe('abandoned')
  })

  it('usa el marcador a 90 minutos (fulltime), no el de la prórroga', () => {
    const fixture = normalizeFixture(raw(1, 'AET', [2, 2], [3, 2]))
    expect(fixture).toMatchObject({ state: 'final', home_goals: 2, away_goals: 2, provider_status: 'AET' })
  })

  it('no promueve a final un partido sin marcador utilizable', () => {
    expect(normalizeFixture(raw(2, 'FT', [null, null]))).toMatchObject({ state: 'scheduled', home_goals: null, away_goals: null })
    expect(normalizeFixture(raw(3, 'FT', [1, null]))).toMatchObject({ state: 'scheduled', home_goals: null })
  })

  it('no expone logos ni URLs del proveedor (licencia sin verificar)', () => {
    const fixture = normalizeFixture(raw(4, 'NS'))
    expect(JSON.stringify(fixture)).not.toMatch(/logo|media\.example|https?:/)
  })

  it('descarta filas inválidas y fechas imposibles', () => {
    expect(normalizeFixture({})).toBeNull()
    const same = raw(5, 'NS'); same.teams.away.id = 44
    expect(normalizeFixture(same)).toBeNull()
    const bad = raw(6, 'NS'); bad.fixture.date = 'no-es-fecha'
    expect(normalizeFixture(bad)?.starts_at).toBeNull()
  })

  it('normaliza competiciones con sus temporadas', () => {
    const competition = normalizeCompetition({
      league: { id: 39, name: 'Premier League', type: 'League', logo: 'x' }, country: { name: 'England', code: 'GB-ENG' },
      seasons: [{ year: 2023, start: '2023-08-11', end: '2024-05-19', current: false }, { year: 'x' }],
    })
    expect(competition).toEqual({ external_id: '39', name: 'Premier League', kind: 'league', country_name: 'England', country_code: 'GB-ENG',
      seasons: [{ year: 2023, start: '2023-08-11', end: '2024-05-19', current: false }] })
  })
})

describe('adaptador API-Football (respuestas simuladas)', () => {
  it('envía la clave solo en cabecera y devuelve fixtures normalizados', async () => {
    const fetchImpl = vi.fn(async () => ok([raw(10, 'FT', [1, 0])]))
    const provider = createApiFootballProvider({ apiKey: 'SECRETO', fetchImpl, sleep: noSleep })
    const rows = await provider.getSeasonFixtures('39', 2023)
    expect(rows).toHaveLength(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/fixtures?league=39&season=2023')
    expect(url).not.toContain('SECRETO')
    expect((init.headers as Record<string, string>)['x-apisports-key']).toBe('SECRETO')
  })

  it('sin clave configurada falla sin llamar a la red', async () => {
    const fetchImpl = vi.fn()
    const provider = createApiFootballProvider({ apiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(provider.getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('429: reintenta con backoff y se recupera', async () => {
    const answers = [new Response('', { status: 429 }), new Response('', { status: 429, headers: { 'retry-after': '2' } }), ok([raw(11, 'NS')])]
    const sleep = vi.fn(noSleep)
    const provider = createApiFootballProvider({ apiKey: 'k', fetchImpl: vi.fn(async () => answers.shift() as Response), sleep, plan: 'paid' })
    await expect(provider.getFixturesByIds(['11'])).resolves.toHaveLength(1)
    expect(sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(sleep).toHaveBeenNthCalledWith(2, 2000)
  })

  it('429 persistente: se rinde tras los reintentos acotados (3 intentos)', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 429 }))
    const provider = createApiFootballProvider({ apiKey: 'k', fetchImpl, sleep: noSleep, maxRetries: 2 })
    await expect(provider.getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('el reintento máximo está acotado aunque se pida más', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
    const provider = createApiFootballProvider({ apiKey: 'k', fetchImpl, sleep: noSleep, maxRetries: 99 })
    await expect(provider.getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'UPSTREAM' })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('errors.rateLimit con HTTP 200 se trata como 429', async () => {
    const answers = [new Response(JSON.stringify({ errors: { rateLimit: 'Too many requests' }, response: [] }), { status: 200 }), ok([raw(12, 'NS')])]
    const provider = createApiFootballProvider({ apiKey: 'k', fetchImpl: vi.fn(async () => answers.shift() as Response), sleep: noSleep, plan: 'paid' })
    await expect(provider.getFixturesByIds(['12'])).resolves.toHaveLength(1)
  })

  it('mapea errores de plan, token y solicitud sin reintentar', async () => {
    const cases: [unknown, string][] = [[{ plan: 'Free plans do not have access to this season' }, 'PLAN_RESTRICTED'], [{ token: 'Error/Missing application key' }, 'AUTH'], [{ league: 'bad' }, 'BAD_REQUEST'], [{ requests: 'limit reached' }, 'QUOTA_EXHAUSTED']]
    for (const [errors, code] of cases) {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors, response: [] }), { status: 200 }))
      const provider = createApiFootballProvider({ apiKey: 'k', fetchImpl, sleep: noSleep })
      await expect(provider.getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })

  it('401/403 no se reintentan y 5xx/red sí, de forma acotada', async () => {
    const auth = vi.fn(async () => new Response('', { status: 401 }))
    await expect(createApiFootballProvider({ apiKey: 'k', fetchImpl: auth, sleep: noSleep }).getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'AUTH' })
    expect(auth).toHaveBeenCalledTimes(1)
    const down = vi.fn(async () => { throw new TypeError('network') })
    await expect(createApiFootballProvider({ apiKey: 'k', fetchImpl: down as unknown as typeof fetch, sleep: noSleep }).getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'UPSTREAM' })
    expect(down).toHaveBeenCalledTimes(3)
  })

  it('cada intento reserva cuota ANTES de salir y sin cuota no hay petición', async () => {
    const gate = vi.fn(async () => true)
    const answers = [new Response('', { status: 500 }), ok([])]
    const fetchImpl = vi.fn(async () => answers.shift() as Response)
    await createApiFootballProvider({ apiKey: 'k', fetchImpl, gate, sleep: noSleep }).getSeasonFixtures('39', 2023)
    expect(gate).toHaveBeenCalledTimes(2)
    const closed = vi.fn(async () => new Response('', { status: 200 }))
    await expect(createApiFootballProvider({ apiKey: 'k', fetchImpl: closed, gate: async () => false }).getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' })
    expect(closed).not.toHaveBeenCalled()
  })

  it('valida entradas: búsqueda mínima, ids numéricos y lote máximo de 20', async () => {
    const fetchImpl = vi.fn(async () => ok([]))
    const provider = createApiFootballProvider({ apiKey: 'k', fetchImpl, sleep: noSleep, plan: 'paid' })
    await expect(provider.searchCompetitions('ab')).rejects.toBeInstanceOf(ProviderError)
    await expect(provider.getFixturesByIds(Array.from({ length: 21 }, (_, i) => String(i + 1)))).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(provider.getFixturesByIds(['abc', '1;DROP'])).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('plan gratuito: no usa `ids` (lo rechaza el proveedor) y consulta live=all', async () => {
    const fetchImpl = vi.fn(async () => ok([raw(20, '1H')]))
    const provider = createApiFootballProvider({ apiKey: 'k', fetchImpl, sleep: noSleep })
    expect(provider.supportsIdsLookup).toBe(false)
    await expect(provider.getFixturesByIds(['1'])).rejects.toMatchObject({ code: 'PLAN_RESTRICTED' })
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(provider.getLiveFixtures()).resolves.toMatchObject([{ state: 'live' }])
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('live=all')
  })

  it('une los ids en una sola solicitud', async () => {
    const fetchImpl = vi.fn(async () => ok([]))
    await createApiFootballProvider({ apiKey: 'k', fetchImpl, sleep: noSleep, plan: 'paid' }).getFixturesByIds(['1', '2', '2', '3'])
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('ids=1-2-3')
  })

  it('respuesta no JSON o sin arreglo → BAD_RESPONSE', async () => {
    const html = vi.fn(async () => new Response('<html>', { status: 200 }))
    await expect(createApiFootballProvider({ apiKey: 'k', fetchImpl: html, sleep: noSleep }).getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    const noArray = vi.fn(async () => new Response(JSON.stringify({ errors: [], response: {} }), { status: 200 }))
    await expect(createApiFootballProvider({ apiKey: 'k', fetchImpl: noArray, sleep: noSleep }).getSeasonFixtures('39', 2023)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})
