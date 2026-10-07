// BORRADOR TÉCNICO de preparación para Fase 06: costura entre la UI y el origen de datos.
//
// `useSportsCatalog` consume un `SportsDataSource`. Hoy solo la vista previa lo implementa y está
// activa. `createSupabaseSportsSource` describe cómo se leerá la parrilla real (solo SELECT sobre
// tablas de Fase 03, bajo RLS) pero NO está conectada a la app ni se ha probado contra QA: se
// activará cuando QA vuelva y Fase 06 se autorice formalmente.
import {
  mapSportsRows,
  type AdaptedCatalog,
  type MatchRow,
  type OfficialResultRow,
  type RoundRow,
  type SportsRows,
  type TeamRow,
  type TournamentRow,
} from './sports-adapters'

export interface SportsDataSource {
  readonly kind: 'preview' | 'supabase'
  load(): Promise<AdaptedCatalog>
}

type QueryResult = { data: unknown[] | null; error: { message: string } | null }
type TableName = 'tournaments' | 'teams' | 'rounds' | 'matches' | 'official_results'

// Cliente mínimo: lo que usa la fuente. `supabase-js` lo satisface; los tests usan uno simulado.
export type SportsSourceClient = {
  from(table: TableName): { select(columns: string): PromiseLike<QueryResult> }
}

// Columnas pedidas por tabla. No se pide `tenant_id`: el cliente jamás lo usa para autorizar y
// minimizar columnas reduce lo expuesto. RLS (`is_tenant_member`) decide qué filas llegan.
export const SPORTS_COLUMNS = {
  tournaments: 'id, name',
  teams: 'id, name, crest_asset_path',
  rounds: 'id, tournament_id, name, sort_order',
  matches: 'id, tournament_id, round_id, home_team_id, away_team_id, starts_at, status',
  official_results: 'match_id, home_score, away_score, revision',
} as const satisfies Record<TableName, string>

type Guard<T> = (value: unknown) => value is T
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const str = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const int = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)

const isTournament: Guard<TournamentRow> = (v): v is TournamentRow => isRecord(v) && str(v.id) && str(v.name)
const isTeam: Guard<TeamRow> = (v): v is TeamRow => isRecord(v) && str(v.id) && str(v.name) && (v.crest_asset_path === null || typeof v.crest_asset_path === 'string')
const isRound: Guard<RoundRow> = (v): v is RoundRow => isRecord(v) && str(v.id) && str(v.tournament_id) && str(v.name) && int(v.sort_order)
const isMatch: Guard<MatchRow> = (v): v is MatchRow =>
  isRecord(v) && str(v.id) && str(v.tournament_id) && str(v.round_id) && str(v.home_team_id) && str(v.away_team_id) && str(v.starts_at) && str(v.status)
const isResult: Guard<OfficialResultRow> = (v): v is OfficialResultRow => isRecord(v) && str(v.match_id) && int(v.home_score) && int(v.away_score) && int(v.revision)

// Filas con forma inesperada se descartan en lugar de romper la pantalla.
function keep<T>(data: unknown[] | null, guard: Guard<T>): T[] {
  return (data ?? []).filter(guard)
}

export function createSupabaseSportsSource(client: SportsSourceClient): SportsDataSource {
  return {
    kind: 'supabase',
    async load() {
      const [tournaments, teams, rounds, matches, results] = await Promise.all(
        (Object.keys(SPORTS_COLUMNS) as TableName[]).map((table) => client.from(table).select(SPORTS_COLUMNS[table])),
      )
      // Mensaje genérico: nunca se propaga el texto de la base de datos a la UI.
      if ([tournaments, teams, rounds, matches, results].some((result) => result?.error)) throw new Error('SPORTS_SOURCE_FAILED')

      const rows: SportsRows = {
        tournaments: keep(tournaments?.data ?? null, isTournament),
        teams: keep(teams?.data ?? null, isTeam),
        rounds: keep(rounds?.data ?? null, isRound),
        matches: keep(matches?.data ?? null, isMatch),
        officialResults: keep(results?.data ?? null, isResult),
      }
      return mapSportsRows(rows)
    },
  }
}
