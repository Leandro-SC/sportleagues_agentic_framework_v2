// Contrato de presentación del catálogo deportivo (borrador técnico previo a Fase 06).
// Los nombres de campo siguen las tablas de Fase 03 (`tournaments`, `teams`, `matches`,
// `official_results`) para que la fuente de vista previa se pueda sustituir por consultas reales
// sin tocar las pantallas. Nada de este módulo es autoridad: el lock y el scoring siguen en DB.
import { normalizeJoinCode } from './join-intent'

export type SportKey = 'football' | 'basketball' | 'tennis' | 'volleyball'
export type SportFilter = SportKey | 'all'
export type MatchStatus = 'scheduled' | 'live' | 'final' // espejo de public.match_status
export type MatchWindow = 'today' | 'tomorrow' | 'week'
export type CountryCode = 'MX' | 'ES' | 'GB' | 'IT' | 'PE' | 'BR' | 'AR'

export type Competition = {
  id: string
  name: string
  sport: SportKey
  country: CountryCode | null
  country_name: string
  accent: string
  season_label: string
}

// `country`, `country_name` y `competition_id` son opcionales en datos reales: la tabla `teams` de
// Fase 03 no tiene país ni torneo (un equipo pertenece al tenant, no a una competición). La vista
// previa los rellena; el adaptador de Fase 06 los deriva o los deja en null/vacío.
export type Team = {
  id: string
  name: string
  short_name: string
  colors: [string, string]
  competition_id: string | null
  country: CountryCode | null
  country_name: string
  crest_path?: string | null
}

export type Match = {
  id: string
  tournament_id: string
  round_name: string
  home_team_id: string
  away_team_id: string
  starts_at: string
  status: MatchStatus
  home_score: number | null
  away_score: number | null
  minute: number | null
}

export type StandingRow = {
  team_id: string
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
}

export type CommunityLeague = {
  id: string
  name: string
  code: string
  sport: SportKey
  teams_count: number | null
  members_count: number
  capacity: number | null
  format_label: string
  colors: [string, string]
}

export type ActivityKind = 'joined' | 'prediction' | 'match' | 'achievement'
export type ActivityItem = { id: string; kind: ActivityKind; title: string; detail: string; occurred_at: string }

export type SportsCatalog = {
  competitions: Competition[]
  teams: Team[]
  matches: Match[]
  standings: Record<string, StandingRow[]>
  communityLeagues: CommunityLeague[]
  activity: ActivityItem[]
  followedTeamIds: string[]
  profileStats: { tournaments: number; points: number; level: string; weeklyPoints: number } | null
}

export const EMPTY_CATALOG: SportsCatalog = {
  competitions: [],
  teams: [],
  matches: [],
  standings: {},
  communityLeagues: [],
  activity: [],
  followedTeamIds: [],
  profileStats: null,
}

export const SPORT_LABELS: Record<SportKey, string> = {
  football: 'Fútbol',
  basketball: 'Básquet',
  tennis: 'Tenis',
  volleyball: 'Vóley',
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dayOffset(target: Date, now: Date): number {
  return Math.round((startOfLocalDay(target).getTime() - startOfLocalDay(now).getTime()) / DAY_MS)
}

const STATUS_ORDER: Record<MatchStatus, number> = { live: 0, scheduled: 1, final: 2 }

export function sortMatches(matches: Match[]): Match[] {
  return [...matches].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.starts_at.localeCompare(b.starts_at))
}

// Ventanas en el calendario local del dispositivo. Los partidos en vivo siempre cuentan como "hoy".
export function matchesInWindow(matches: Match[], window: MatchWindow, now: Date): Match[] {
  return sortMatches(matches.filter((match) => {
    const offset = dayOffset(new Date(match.starts_at), now)
    if (window === 'today') return match.status === 'live' || offset === 0
    if (window === 'tomorrow') return match.status !== 'live' && offset === 1
    return match.status === 'live' || (offset >= 0 && offset < 7)
  }))
}

export function matchesForSport(matches: Match[], competitions: Competition[], sport: SportFilter): Match[] {
  if (sport === 'all') return matches
  const ids = new Set(competitions.filter((competition) => competition.sport === sport).map((competition) => competition.id))
  return matches.filter((match) => ids.has(match.tournament_id))
}

export function upcomingMatches(matches: Match[], now: Date, limit = 3): Match[] {
  return sortMatches(matches.filter((match) => match.status === 'scheduled' && new Date(match.starts_at) > now)).slice(0, limit)
}

export function teamMatches(matches: Match[], teamId: string, limit = 5): Match[] {
  return matches
    .filter((match) => match.home_team_id === teamId || match.away_team_id === teamId)
    .filter((match) => match.status !== 'scheduled')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.starts_at.localeCompare(a.starts_at))
    .slice(0, limit)
}

function clock(date: Date): string {
  return date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' }).replace('.', '')
}

export type KickoffLabel = { text: string; tone: 'live' | 'final' | 'today' | 'neutral' }

export function kickoffLabel(match: Match, now: Date): KickoffLabel {
  const startsAt = new Date(match.starts_at)
  const offset = dayOffset(startsAt, now)
  if (match.status === 'live') return { text: 'En vivo', tone: 'live' }
  if (match.status === 'final') return { text: 'Finalizado', tone: 'final' }
  if (offset === 0) return { text: `Hoy · ${clock(startsAt)}`, tone: 'today' }
  if (offset === 1) return { text: `Mañana · ${clock(startsAt)}`, tone: 'neutral' }
  return { text: `${shortDate(startsAt)} · ${clock(startsAt)}`, tone: 'neutral' }
}

// Etiqueta corta bajo el marcador: minuto en vivo, hora de inicio o fecha del resultado.
export function matchMoment(match: Match, now: Date): string {
  const startsAt = new Date(match.starts_at)
  if (match.status === 'live') return match.minute != null ? `${match.minute}'` : 'En vivo'
  if (match.status === 'scheduled') return clock(startsAt)
  return dayOffset(startsAt, now) === 0 ? 'Hoy' : shortDate(startsAt)
}

export function kickoffTime(match: Match): string {
  return clock(new Date(match.starts_at))
}

export function relativeTimeLabel(isoDate: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(isoDate).getTime()) / 60000))
  if (minutes < 1) return 'Hace un momento'
  if (minutes < 60) return minutes === 1 ? 'Hace 1 minuto' : `Hace ${minutes} minutos`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'Hace 1 hora' : `Hace ${hours} horas`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Hace 1 día' : `Hace ${days} días`
}

export type RankedStanding = StandingRow & { position: number; points: number; goal_difference: number }

export function standingPoints(row: StandingRow): number {
  return row.won * 3 + row.drawn
}

// Desempate de presentación: puntos, diferencia de goles, goles a favor y nombre estable.
// No es la regla de desempate de la quiniela (ADR-003); solo ordena la tabla del torneo.
export function rankStandings(rows: StandingRow[], teamName: (teamId: string) => string = (id) => id): RankedStanding[] {
  return rows
    .map((row) => ({ ...row, points: standingPoints(row), goal_difference: row.goals_for - row.goals_against }))
    .sort((a, b) => b.points - a.points
      || b.goal_difference - a.goal_difference
      || b.goals_for - a.goals_for
      || teamName(a.team_id).localeCompare(teamName(b.team_id)))
    .map((row, index) => ({ ...row, position: index + 1 }))
}

export type FormResult = 'G' | 'E' | 'P'

// Racha de resultados finales del equipo, del más reciente al más antiguo (G/E/P).
export function teamForm(matches: Match[], teamId: string, limit = 5): FormResult[] {
  return matches
    .filter((match) => match.status === 'final' && match.home_score != null && match.away_score != null)
    .filter((match) => match.home_team_id === teamId || match.away_team_id === teamId)
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    .slice(0, limit)
    .map((match) => {
      const own = match.home_team_id === teamId ? match.home_score! : match.away_score!
      const rival = match.home_team_id === teamId ? match.away_score! : match.home_score!
      return own > rival ? 'G' : own === rival ? 'E' : 'P'
    })
}

export type LeagueQuery = { kind: 'empty' } | { kind: 'code'; code: string } | { kind: 'text'; text: string }

export function classifyLeagueQuery(value: string): LeagueQuery {
  const text = value.trim().replace(/^#/, '')
  if (!text) return { kind: 'empty' }
  const code = normalizeJoinCode(text)
  return code ? { kind: 'code', code } : { kind: 'text', text }
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function matchesText(value: string, query: string): boolean {
  return normalizeText(value).includes(normalizeText(query.trim()))
}

export type CatalogSearchResult =
  | { kind: 'pool'; id: string; title: string; subtitle: string }
  | { kind: 'competition'; id: string; title: string; subtitle: string }
  | { kind: 'team'; id: string; title: string; subtitle: string }

export function searchCatalog(
  query: string,
  catalog: Pick<SportsCatalog, 'competitions' | 'teams'>,
  pools: Array<{ id: string; name: string }>,
  limit = 6,
): CatalogSearchResult[] {
  if (query.trim().length < 2) return []
  const competitionName = new Map(catalog.competitions.map((competition) => [competition.id, competition.name]))
  return [
    ...pools.filter((pool) => matchesText(pool.name, query))
      .map((pool) => ({ kind: 'pool' as const, id: pool.id, title: pool.name, subtitle: 'Tu liga' })),
    ...catalog.competitions.filter((competition) => matchesText(competition.name, query))
      .map((competition) => ({ kind: 'competition' as const, id: competition.id, title: competition.name, subtitle: competition.country_name })),
    ...catalog.teams.filter((team) => matchesText(team.name, query))
      .map((team) => ({ kind: 'team' as const, id: team.id, title: team.name, subtitle: (team.competition_id ? competitionName.get(team.competition_id) : undefined) ?? team.country_name })),
  ].slice(0, limit)
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]!.toUpperCase()).join('') || '?'
}

export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}
