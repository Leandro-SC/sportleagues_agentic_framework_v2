import { computed, ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import { humanizeSportsRpcError, type MatchRow, type ResultRow, type RoundRow, type TeamRow, type TournamentRow } from '../lib/sports-admin'

type RpcError = { message: string; code?: string; hint?: string }
type Query = PromiseLike<{ data: unknown[] | null; error: RpcError | null }> & {
  eq(column: string, value: string): Query
  in(column: string, values: string[]): Query
  order(column: string, options?: { ascending: boolean }): Query
}
// Cliente mínimo: lo que usa el composable (supabase-js lo satisface; los tests usan uno simulado).
export type SportsAdminClient = {
  from(table: string): { select(columns: string): Query }
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>
}

const COLUMNS = {
  tournaments: 'id, name, sport_code, country_code, season_label, color',
  teams: 'id, name, short_name, country_code, primary_color, secondary_color',
  rounds: 'id, tournament_id, name, sort_order',
  matches: 'id, tournament_id, round_id, home_team_id, away_team_id, starts_at, status',
  official_results: 'match_id, home_score, away_score, revision',
} as const

// Administración de la base deportiva. Toda escritura pasa por RPC (ADR-011): el tenant lo deriva el servidor de la entidad o
// del usuario autenticado; el que se envía al crear solo localiza el tenant y nunca autoriza. Lectura bajo RLS.
export function useSportsAdmin(clientFactory: () => SportsAdminClient = () => getSupabaseClient() as unknown as SportsAdminClient) {
  const tenantId = ref('')
  const timezone = ref('UTC')
  const tournaments = ref<TournamentRow[]>([])
  const teams = ref<TeamRow[]>([])
  const enrolledTeamIds = ref<string[]>([])
  const rounds = ref<RoundRow[]>([])
  const matches = ref<MatchRow[]>([])
  const results = ref<Record<string, ResultRow>>({})
  const poolMatchIds = ref<string[]>([])
  const selectedTournamentId = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  const selectedTournament = computed(() => tournaments.value.find((tournament) => tournament.id === selectedTournamentId.value) ?? null)
  const enrolledTeams = computed(() => teams.value.filter((team) => enrolledTeamIds.value.includes(team.id)))
  const teamName = (id: string): string => teams.value.find((team) => team.id === id)?.name ?? '—'

  async function read<T>(table: keyof typeof COLUMNS, shape: (query: Query) => Query): Promise<T[]> {
    const { data, error: readError } = await shape(clientFactory().from(table).select(COLUMNS[table]))
    if (readError) throw new Error(readError.message)
    return (data ?? []) as T[]
  }

  async function loadCatalog(forTenantId: string): Promise<void> {
    tenantId.value = forTenantId
    loading.value = true; error.value = ''
    try {
      const [tenantRows, tournamentRows, teamRows] = await Promise.all([
        clientFactory().from('tenants').select('timezone').eq('id', forTenantId),
        read<TournamentRow>('tournaments', (query) => query.eq('tenant_id', forTenantId).order('name')),
        read<TeamRow>('teams', (query) => query.eq('tenant_id', forTenantId).order('name')),
      ])
      timezone.value = ((tenantRows.data?.[0] as { timezone?: string } | undefined)?.timezone) ?? 'UTC'
      tournaments.value = tournamentRows
      teams.value = teamRows
      if (!tournaments.value.some((tournament) => tournament.id === selectedTournamentId.value)) selectedTournamentId.value = tournaments.value[0]?.id ?? ''
      await loadTournament()
    } catch {
      error.value = 'No fue posible cargar la parrilla.'
    } finally {
      loading.value = false
    }
  }

  async function loadTournament(): Promise<void> {
    const id = selectedTournamentId.value
    if (!id) { enrolledTeamIds.value = []; rounds.value = []; matches.value = []; results.value = {}; return }
    const enrolment = await clientFactory().from('tournament_teams').select('team_id').eq('tournament_id', id)
    if (enrolment.error) throw new Error(enrolment.error.message)
    enrolledTeamIds.value = (enrolment.data ?? []).map((row) => (row as { team_id: string }).team_id)
    rounds.value = await read<RoundRow>('rounds', (query) => query.eq('tournament_id', id).order('sort_order'))
    matches.value = await read<MatchRow>('matches', (query) => query.eq('tournament_id', id).order('starts_at'))
    const ids = matches.value.map((match) => match.id)
    const resultRows = ids.length ? await read<ResultRow>('official_results', (query) => query.in('match_id', ids)) : []
    results.value = Object.fromEntries(resultRows.map((row) => [row.match_id, row]))
  }

  async function loadPoolMatches(poolId: string): Promise<void> {
    if (!poolId) { poolMatchIds.value = []; return }
    const { data, error: readError } = await clientFactory().from('pool_matches').select('match_id').eq('pool_id', poolId)
    poolMatchIds.value = readError ? [] : (data ?? []).map((row) => (row as { match_id: string }).match_id)
  }

  async function mutate(fn: string, args: Record<string, unknown>, refresh: 'catalog' | 'tournament' | 'none' = 'tournament'): Promise<{ message: string | null; data: unknown }> {
    saving.value = true
    try {
      const { data, error: rpcError } = await clientFactory().rpc(fn, args)
      if (rpcError) return { message: humanizeSportsRpcError(rpcError.message, rpcError.code), data: null }
      if (refresh === 'catalog') await loadCatalog(tenantId.value)
      else if (refresh === 'tournament') await loadTournament()
      return { message: null, data }
    } catch {
      return { message: humanizeSportsRpcError(null), data: null }
    } finally {
      saving.value = false
    }
  }

  async function saveTournament(input: { id?: string; name: string; sportCode: string; countryCode: string; seasonLabel: string; color: string }): Promise<string | null> {
    const { message, data } = await mutate('upsert_tournament', {
      p_tenant_id: tenantId.value, p_tournament_id: input.id ?? null, p_name: input.name, p_sport_code: input.sportCode,
      p_country_code: input.countryCode.trim() || null, p_season_label: input.seasonLabel.trim() || null, p_color: input.color.trim() || null,
    }, 'catalog')
    if (!message && !input.id && data && typeof data === 'object') selectedTournamentId.value = (data as TournamentRow).id
    if (!message && !input.id) await loadTournament()
    return message
  }

  async function saveTeam(input: { id?: string; name: string; shortName: string; countryCode: string; primaryColor: string; secondaryColor: string }): Promise<string | null> {
    return (await mutate('upsert_team', {
      p_tenant_id: tenantId.value, p_team_id: input.id ?? null, p_name: input.name, p_short_name: input.shortName.trim() || null,
      p_country_code: input.countryCode.trim() || null, p_primary_color: input.primaryColor.trim() || null, p_secondary_color: input.secondaryColor.trim() || null,
    }, 'catalog')).message
  }

  /** Alta exprés de varios equipos; los inscribe en el torneo seleccionado. Devuelve el primer error o null. */
  async function addTeamsInBulk(input: { name: string; shortName: string | null }[]): Promise<string | null> {
    for (const team of input) {
      const created = await mutate('upsert_team', { p_tenant_id: tenantId.value, p_team_id: null, p_name: team.name, p_short_name: team.shortName, p_country_code: null, p_primary_color: null, p_secondary_color: null }, 'none')
      if (created.message) return created.message
      const id = (created.data as TeamRow | null)?.id
      if (id && selectedTournamentId.value) {
        const enrolled = await mutate('set_tournament_team', { p_tournament_id: selectedTournamentId.value, p_team_id: id, p_enrolled: true }, 'none')
        if (enrolled.message) return enrolled.message
      }
    }
    await loadCatalog(tenantId.value)
    return null
  }

  async function setEnrolled(teamId: string, enrolled: boolean): Promise<string | null> {
    return (await mutate('set_tournament_team', { p_tournament_id: selectedTournamentId.value, p_team_id: teamId, p_enrolled: enrolled })).message
  }

  async function saveRound(input: { id?: string; name: string; sortOrder: number }): Promise<string | null> {
    return (await mutate('upsert_round', { p_tournament_id: selectedTournamentId.value, p_round_id: input.id ?? null, p_name: input.name, p_sort_order: input.sortOrder })).message
  }

  async function reorderRounds(orderedIds: string[]): Promise<string | null> {
    return (await mutate('reorder_rounds', { p_tournament_id: selectedTournamentId.value, p_round_ids: orderedIds })).message
  }

  async function saveMatch(input: { id?: string; roundId: string; homeTeamId: string; awayTeamId: string; startsAtIso: string }): Promise<string | null> {
    return (await mutate('upsert_match', {
      p_tournament_id: selectedTournamentId.value, p_match_id: input.id ?? null, p_round_id: input.roundId,
      p_home_team_id: input.homeTeamId, p_away_team_id: input.awayTeamId, p_starts_at: input.startsAtIso,
    })).message
  }

  async function removeMatch(matchId: string): Promise<string | null> {
    return (await mutate('delete_match', { p_match_id: matchId })).message
  }

  async function setPoolMatch(poolId: string, matchId: string, included: boolean): Promise<string | null> {
    const { message } = await mutate('set_pool_match', { p_pool_id: poolId, p_match_id: matchId, p_included: included }, 'none')
    if (!message) await loadPoolMatches(poolId)
    return message
  }

  /** Publica o corrige el resultado. La revisión esperada evita pisar una corrección ajena (ADR-012). */
  async function publishResult(matchId: string, homeScore: number, awayScore: number): Promise<string | null> {
    const expected = results.value[matchId]?.revision ?? 0
    return (await mutate('publish_official_result', { p_match_id: matchId, p_home_score: homeScore, p_away_score: awayScore, p_expected_revision: expected })).message
  }

  return {
    tenantId, timezone, tournaments, teams, enrolledTeamIds, enrolledTeams, rounds, matches, results, poolMatchIds, selectedTournamentId, selectedTournament,
    loading, saving, error, teamName,
    loadCatalog, loadTournament, loadPoolMatches, saveTournament, saveTeam, addTeamsInBulk, setEnrolled, saveRound, reorderRounds, saveMatch, removeMatch, setPoolMatch, publishResult,
  }
}
