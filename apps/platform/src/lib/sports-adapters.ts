// BORRADOR TÉCNICO de preparación para Fase 06 (no es su inicio formal ni está conectado a la app).
//
// Convierte filas con las columnas EXACTAS de Fase 03 (`tournaments`, `teams`, `rounds`,
// `matches`, `official_results`) en el modelo de presentación de `sports-catalog.ts`. Es una
// función pura: no lee Supabase, no autoriza y no toma decisiones de lock ni de scoring (ADR-003).
// Las filas llegan ya filtradas por RLS; aquí solo se valida su coherencia y se rellena lo que la
// base todavía no modela. Qué falta conectar: docs/design/PHASE-06-FRONTEND-DATA-CONTRACT-DRAFT.md
import {
  EMPTY_CATALOG,
  type Competition,
  type Match,
  type MatchStatus,
  type SportsCatalog,
  type StandingRow,
  type Team,
} from './sports-catalog'

// --- Filas de base de datos (sin tenant_id a propósito: el cliente nunca lo usa para autorizar). ---
export type TournamentRow = { id: string; name: string }
export type TeamRow = { id: string; name: string; crest_asset_path: string | null }
export type RoundRow = { id: string; tournament_id: string; name: string; sort_order: number }
export type MatchRow = {
  id: string
  tournament_id: string
  round_id: string
  home_team_id: string
  away_team_id: string
  starts_at: string
  status: string
}
export type OfficialResultRow = { match_id: string; home_score: number; away_score: number; revision: number }

export type SportsRows = {
  tournaments: TournamentRow[]
  teams: TeamRow[]
  rounds: RoundRow[]
  matches: MatchRow[]
  officialResults: OfficialResultRow[]
}

export type AdapterWarning = { code: string; entity: 'match' | 'team' | 'round' | 'result'; id: string }
export type AdaptedCatalog = { catalog: SportsCatalog; warnings: AdapterWarning[] }

const MATCH_STATUSES: readonly MatchStatus[] = ['scheduled', 'live', 'final']

function isMatchStatus(value: string): value is MatchStatus {
  return (MATCH_STATUSES as readonly string[]).includes(value)
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// "Real Madrid" → "RM"; "Pumas" → "PUM". Solo para el escudo genérico; no es un dato del equipo.
export function deriveShortName(name: string): string {
  const words = stripAccents(name).split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length > 1) return words.slice(0, 3).map((word) => word[0]!.toUpperCase()).join('')
  return (words[0] ?? '?').slice(0, 3).toUpperCase()
}

const CREST_PALETTE: Array<[string, string]> = [
  ['#1d4ed8', '#f8fafc'],
  ['#dc2626', '#111827'],
  ['#15803d', '#f8fafc'],
  ['#f59e0b', '#1e40af'],
  ['#7c3aed', '#f8fafc'],
  ['#0891b2', '#0b2a6b'],
  ['#be123c', '#fde68a'],
  ['#334155', '#21f59a'],
]

// Colores estables por equipo mientras `teams` no tenga colores propios: mismo id, mismo escudo.
export function deriveTeamColors(teamId: string): [string, string] {
  let hash = 0
  for (const char of teamId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return CREST_PALETTE[hash % CREST_PALETTE.length]!
}

// Tabla de posiciones DERIVADA, solo de presentación, desde partidos finales con resultado oficial.
// No sustituye a ninguna regla de la quiniela ni al leaderboard de Fase 08.
export function computeStandings(matches: Match[]): Record<string, StandingRow[]> {
  const byTournament = new Map<string, Map<string, StandingRow>>()
  const row = (tournamentId: string, teamId: string): StandingRow => {
    const table = byTournament.get(tournamentId) ?? new Map<string, StandingRow>()
    byTournament.set(tournamentId, table)
    const existing = table.get(teamId) ?? { team_id: teamId, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0 }
    table.set(teamId, existing)
    return existing
  }

  for (const match of matches) {
    // Todo equipo del torneo aparece en la tabla, aunque aún no haya jugado.
    const home = row(match.tournament_id, match.home_team_id)
    const away = row(match.tournament_id, match.away_team_id)
    if (match.status !== 'final' || match.home_score == null || match.away_score == null) continue
    home.played += 1
    away.played += 1
    home.goals_for += match.home_score
    home.goals_against += match.away_score
    away.goals_for += match.away_score
    away.goals_against += match.home_score
    if (match.home_score > match.away_score) { home.won += 1; away.lost += 1 }
    else if (match.home_score < match.away_score) { away.won += 1; home.lost += 1 }
    else { home.drawn += 1; away.drawn += 1 }
  }

  return Object.fromEntries([...byTournament].map(([tournamentId, table]) => [tournamentId, [...table.values()]]))
}

export function mapSportsRows(rows: SportsRows): AdaptedCatalog {
  const warnings: AdapterWarning[] = []
  const tournamentIds = new Set(rows.tournaments.map((tournament) => tournament.id))
  const teamIds = new Set(rows.teams.map((team) => team.id))
  const roundById = new Map(rows.rounds.map((round) => [round.id, round]))
  const resultByMatch = new Map<string, OfficialResultRow>()

  for (const result of rows.officialResults) {
    if (!isScore(result.home_score) || !isScore(result.away_score)) {
      warnings.push({ code: 'RESULT_INVALID_SCORE', entity: 'result', id: result.match_id })
      continue
    }
    const current = resultByMatch.get(result.match_id)
    if (!current || result.revision > current.revision) resultByMatch.set(result.match_id, result)
  }

  const matches: Match[] = []
  for (const match of rows.matches) {
    if (!isMatchStatus(match.status)) {
      // Cancelado/postergado no entra al MVP sin contrato de producto: no se inventa un estado.
      warnings.push({ code: 'MATCH_STATUS_UNSUPPORTED', entity: 'match', id: match.id })
      continue
    }
    // Un partido no puede unir equipos o torneo que no estén en el mismo conjunto visible (tenant).
    if (match.home_team_id === match.away_team_id || !teamIds.has(match.home_team_id) || !teamIds.has(match.away_team_id) || !tournamentIds.has(match.tournament_id)) {
      warnings.push({ code: 'MATCH_BROKEN_REFERENCE', entity: 'match', id: match.id })
      continue
    }
    const found = roundById.get(match.round_id)
    // Una jornada de otro torneo no es una jornada válida de este partido: se ignora, no se muestra.
    const round = found && found.tournament_id === match.tournament_id ? found : undefined
    if (!round) warnings.push({ code: 'MATCH_ROUND_MISSING', entity: 'round', id: match.round_id })

    const result = resultByMatch.get(match.id)
    if (match.status === 'final' && !result) {
      // "No permitir final sin score válido": se muestra sin marcador y se avisa.
      warnings.push({ code: 'FINAL_WITHOUT_RESULT', entity: 'match', id: match.id })
    }
    matches.push({
      id: match.id,
      tournament_id: match.tournament_id,
      round_name: round?.name ?? '',
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,
      starts_at: match.starts_at,
      status: match.status,
      home_score: result?.home_score ?? null,
      away_score: result?.away_score ?? null,
      minute: null, // no existe proveedor de datos en vivo en el MVP
    })
  }

  // `teams` no referencia torneos: el torneo de un equipo se deduce del que más partidos le asigna.
  const matchesPerTournament = new Map<string, Map<string, number>>()
  for (const match of matches) {
    for (const teamId of [match.home_team_id, match.away_team_id]) {
      const counts = matchesPerTournament.get(teamId) ?? new Map<string, number>()
      counts.set(match.tournament_id, (counts.get(match.tournament_id) ?? 0) + 1)
      matchesPerTournament.set(teamId, counts)
    }
  }
  const primaryTournament = (teamId: string): string | null => {
    const counts = [...(matchesPerTournament.get(teamId) ?? [])]
    counts.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return counts[0]?.[0] ?? null
  }

  const teams: Team[] = rows.teams.map((team) => ({
    id: team.id,
    name: team.name,
    short_name: deriveShortName(team.name),
    colors: deriveTeamColors(team.id),
    competition_id: primaryTournament(team.id),
    country: null,
    country_name: '',
    crest_path: team.crest_asset_path,
  }))

  const competitions: Competition[] = rows.tournaments.map((tournament) => ({
    id: tournament.id,
    name: tournament.name,
    sport: 'football', // `tournaments` no tiene deporte todavía: ver el documento del contrato
    country: null,
    country_name: '',
    accent: deriveTeamColors(tournament.id)[0],
    season_label: '',
  }))

  return {
    catalog: { ...EMPTY_CATALOG, competitions, teams, matches, standings: computeStandings(matches) },
    warnings,
  }
}
