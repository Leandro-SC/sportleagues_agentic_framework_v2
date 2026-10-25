// Contrato del adaptador de proveedor deportivo (ADR-016). Ningún tipo del proveedor sale de este módulo: el resto del sistema
// solo conoce estas formas normalizadas, de modo que cambiar de proveedor no toca esquema, RPC ni UI.
export type FixtureState = 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled' | 'abandoned'

export type ProviderCompetition = {
  external_id: string
  name: string
  kind: 'league' | 'cup' | 'other'
  country_name: string | null
  country_code: string | null
  seasons: { year: number; start: string | null; end: string | null; current: boolean }[]
}

export type ProviderTeamRef = { external_id: string; name: string; national: boolean }

export type ProviderFixture = {
  external_id: string
  round: string
  home: ProviderTeamRef
  away: ProviderTeamRef
  starts_at: string | null
  provider_status: string
  state: FixtureState
  // Marcador a 90 minutos (tiempo reglamentario). Nulo si el partido no terminó.
  home_goals: number | null
  away_goals: number | null
  provider_updated_at: string | null
}

export type ProviderErrorCode =
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  | 'PLAN_RESTRICTED'
  | 'AUTH'
  | 'UPSTREAM'
  | 'BAD_RESPONSE'
  | 'NOT_CONFIGURED'
  | 'BAD_REQUEST'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  constructor(code: ProviderErrorCode, message: string = code) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}

export interface SportsProvider {
  readonly id: string
  searchCompetitions(query: string): Promise<ProviderCompetition[]>
  getCompetition(externalId: string): Promise<ProviderCompetition | null>
  // Todos los partidos de una temporada en una sola solicitud.
  getSeasonFixtures(competitionExternalId: string, year: number): Promise<ProviderFixture[]>
  // Hasta `maxIdsPerRequest` partidos por solicitud. Solo planes de pago (`supportsIdsLookup`); el plan gratuito rechaza `ids`.
  getFixturesByIds(externalIds: string[]): Promise<ProviderFixture[]>
  readonly maxIdsPerRequest: number
  readonly supportsIdsLookup: boolean
  // Todos los partidos en juego en el mundo en UNA solicitud (disponible tambien en el plan gratuito): el consumidor filtra los suyos.
  getLiveFixtures(): Promise<ProviderFixture[]>
}

// Reserva de cuota: se invoca ANTES de cada intento HTTP. Devuelve false si el tope diario ya se alcanzó.
export type RequestGate = () => Promise<boolean>
