import { ProviderError, type FixtureState, type ProviderCompetition, type ProviderFixture } from './types.ts'

// Estados cortos de API-Football (documentados) → estado interno. Desconocidos → 'scheduled' (nunca inventan un resultado).
const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'])
const FINAL = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO'])

export function mapFixtureState(short: string): FixtureState {
  if (LIVE.has(short)) return 'live'
  if (FINAL.has(short)) return 'final'
  if (short === 'PST') return 'postponed'
  if (short === 'CANC') return 'cancelled'
  if (short === 'ABD') return 'abandoned'
  return 'scheduled' // NS, TBD y desconocidos
}

type Raw = Record<string, unknown>
const rec = (value: unknown): Raw => (typeof value === 'object' && value !== null ? (value as Raw) : {})
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null
const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null)

function validIso(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

export function normalizeFixture(raw: unknown): ProviderFixture | null {
  const item = rec(raw)
  const fixture = rec(item.fixture)
  const teams = rec(item.teams)
  const league = rec(item.league)
  const id = text(fixture.id)
  const homeId = text(rec(teams.home).id)
  const awayId = text(rec(teams.away).id)
  const homeName = text(rec(teams.home).name)
  const awayName = text(rec(teams.away).name)
  const round = text(league.round)
  if (!id || !homeId || !awayId || !homeName || !awayName || !round || homeId === awayId) return null

  const short = text(rec(fixture.status).short) ?? 'NS'
  const state = mapFixtureState(short)
  // Resultado de 90 minutos: score.fulltime. Nunca `goals` (incluye prórroga) ni penales; sin `fulltime` completo no hay resultado.
  const fulltime = rec(rec(item.score).fulltime)
  const home = whole(fulltime.home)
  const away = whole(fulltime.away)
  const hasResult = state === 'final' && home !== null && away !== null
  return {
    external_id: id,
    round,
    home: { external_id: homeId, name: homeName, national: rec(teams.home).national === true },
    away: { external_id: awayId, name: awayName, national: rec(teams.away).national === true },
    starts_at: validIso(fixture.date),
    provider_status: short.slice(0, 12),
    // Un "final" sin marcador utilizable no se promueve a final (se deja programado para reintento).
    state: state === 'final' && !hasResult ? 'scheduled' : state,
    home_goals: hasResult ? home : null,
    away_goals: hasResult ? away : null,
    provider_updated_at: null,
  }
}

export function normalizeCompetition(raw: unknown): ProviderCompetition | null {
  const item = rec(raw)
  const league = rec(item.league)
  const country = rec(item.country)
  const id = text(league.id)
  const name = text(league.name)
  if (!id || !name) return null
  const type = text(league.type)?.toLowerCase()
  const seasons = (Array.isArray(item.seasons) ? item.seasons : [])
    .map((s) => {
      const season = rec(s)
      const year = whole(season.year)
      return year === null ? null : { year, start: text(season.start), end: text(season.end), current: season.current === true }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
  return {
    external_id: id,
    name,
    kind: type === 'league' ? 'league' : type === 'cup' ? 'cup' : 'other',
    country_name: text(country.name),
    country_code: text(country.code),
    seasons,
  }
}

// API-Football responde 200 aun con errores: `errors` es [] o un objeto { campo: mensaje }.
export function assertNoProviderErrors(body: unknown): void {
  const errors = rec(body).errors
  const entries = Array.isArray(errors) ? [] : Object.entries(rec(errors))
  if (!entries.length) return
  const keys = entries.map(([key]) => key.toLowerCase())
  if (keys.includes('ratelimit')) throw new ProviderError('RATE_LIMITED')
  if (keys.includes('token') || keys.includes('required')) throw new ProviderError('AUTH')
  if (keys.includes('plan') || keys.includes('access')) throw new ProviderError('PLAN_RESTRICTED')
  if (keys.includes('requests')) throw new ProviderError('QUOTA_EXHAUSTED')
  throw new ProviderError('BAD_REQUEST')
}
