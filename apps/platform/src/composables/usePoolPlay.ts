import { computed, ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import { humanizePredictionError } from '../lib/prediction-ux'
import type { SportsAdminClient } from './useSportsAdmin'

export type Participation = 'participant' | 'pending' | 'none'
export type FixtureItem = {
  poolMatchId: string; matchId: string; roundId: string; roundName: string; roundOrder: number
  homeName: string; awayName: string; homeShort: string | null; awayShort: string | null
  startsAt: string; lockAt: string; status: 'scheduled' | 'live' | 'final'
  mine: { home: number; away: number } | null
  result: { home: number; away: number; revision: number } | null
  points: number | null
}
export type LeaderRow = { rank: number; participant_id: string; display_name: string; points: number; exact_hits: number; outcome_hits: number; played: number; current_streak: number; best_streak: number; is_me: boolean }

type Row = Record<string, unknown>

// Experiencia del participante (Fase 07/08): parrilla del pool con el lock que persiste el servidor, mis pronósticos, resultados y
// tabla. Solo lectura bajo RLS + RPC `save_prediction` / `pool_leaderboard`; el cliente nunca decide permisos ni cierres.
export function usePoolPlay(clientFactory: () => SportsAdminClient = () => getSupabaseClient() as unknown as SportsAdminClient) {
  const tenantTimezone = ref('UTC')
  const participation = ref<Participation>('none')
  const fixture = ref<FixtureItem[]>([])
  const leaderboard = ref<LeaderRow[]>([])
  const rounds = ref<{ id: string; name: string }[]>([])
  const loading = ref(false)
  const error = ref('')
  const savingMatchId = ref('')
  let currentPoolId = ''
  let currentProfileId = ''

  const myRow = computed(() => leaderboard.value.find((row) => row.is_me) ?? null)
  const canPredict = computed(() => participation.value === 'participant')

  async function rows(table: string, columns: string, shape: (q: ReturnType<ReturnType<SportsAdminClient['from']>['select']>) => ReturnType<ReturnType<SportsAdminClient['from']>['select']>): Promise<Row[]> {
    const { data, error: readError } = await shape(clientFactory().from(table).select(columns))
    if (readError) throw new Error(readError.message)
    return (data ?? []) as Row[]
  }

  async function load(poolId: string, profileId: string): Promise<void> {
    currentPoolId = poolId; currentProfileId = profileId
    loading.value = true; error.value = ''
    try {
      const [pool] = await rows('pools', 'id, tenant_id', (q) => q.eq('id', poolId))
      if (pool) {
        const [tenant] = await rows('tenants', 'timezone', (q) => q.eq('id', pool.tenant_id as string))
        tenantTimezone.value = (tenant?.timezone as string | undefined) ?? 'UTC'
      }
      const [me] = await rows('participants', 'id, approval_status, withdrawn_at', (q) => q.eq('pool_id', poolId).eq('profile_id', profileId))
      participation.value = !me || me.withdrawn_at ? 'none' : me.approval_status === 'approved' ? 'participant' : 'pending'

      const poolMatches = await rows('pool_matches', 'id, match_id, lock_at', (q) => q.eq('pool_id', poolId))
      const matchIds = poolMatches.map((row) => row.match_id as string)
      const matches = matchIds.length ? await rows('matches', 'id, round_id, home_team_id, away_team_id, starts_at, status', (q) => q.in('id', matchIds)) : []
      const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id as string, m.away_team_id as string]))]
      const roundIds = [...new Set(matches.map((m) => m.round_id as string))]
      const [teams, roundRows, results, predictions] = await Promise.all([
        teamIds.length ? rows('teams', 'id, name, short_name', (q) => q.in('id', teamIds)) : Promise.resolve([]),
        roundIds.length ? rows('rounds', 'id, name, sort_order', (q) => q.in('id', roundIds)) : Promise.resolve([]),
        matchIds.length ? rows('official_results', 'match_id, home_score, away_score, revision', (q) => q.in('match_id', matchIds)) : Promise.resolve([]),
        me ? rows('predictions', 'id, pool_match_id, home_score, away_score', (q) => q.eq('pool_id', poolId).eq('participant_id', me.id as string)) : Promise.resolve([]),
      ])
      const predictionIds = predictions.map((p) => p.id as string)
      const events = predictionIds.length ? await rows('scoring_events', 'prediction_id, points, result_revision, rule_version', (q) => q.in('prediction_id', predictionIds)) : []

      const team = new Map(teams.map((t) => [t.id as string, t]))
      const round = new Map(roundRows.map((r) => [r.id as string, r]))
      const result = new Map(results.map((r) => [r.match_id as string, r]))
      const prediction = new Map(predictions.map((p) => [p.pool_match_id as string, p]))
      const latestPoints = (predictionId: string): number | null => {
        const mine = events.filter((e) => e.prediction_id === predictionId)
          .sort((a, b) => (b.result_revision as number) - (a.result_revision as number) || (b.rule_version as number) - (a.rule_version as number))
        return mine.length ? (mine[0]!.points as number) : null
      }

      fixture.value = poolMatches.flatMap((pm): FixtureItem[] => {
        const m = matches.find((x) => x.id === pm.match_id)
        if (!m) return []
        const r = round.get(m.round_id as string)
        const res = result.get(m.id as string)
        const pred = prediction.get(pm.id as string)
        return [{
          poolMatchId: pm.id as string, matchId: m.id as string, roundId: m.round_id as string, roundName: (r?.name as string) ?? '—', roundOrder: (r?.sort_order as number) ?? 0,
          homeName: (team.get(m.home_team_id as string)?.name as string) ?? '—', awayName: (team.get(m.away_team_id as string)?.name as string) ?? '—',
          homeShort: (team.get(m.home_team_id as string)?.short_name as string | null) ?? null, awayShort: (team.get(m.away_team_id as string)?.short_name as string | null) ?? null,
          startsAt: m.starts_at as string, lockAt: pm.lock_at as string, status: m.status as FixtureItem['status'],
          mine: pred ? { home: pred.home_score as number, away: pred.away_score as number } : null,
          result: res ? { home: res.home_score as number, away: res.away_score as number, revision: res.revision as number } : null,
          points: pred ? latestPoints(pred.id as string) : null,
        }]
      }).sort((a, b) => a.roundOrder - b.roundOrder || a.startsAt.localeCompare(b.startsAt))
      rounds.value = [...round.values()].sort((a, b) => (a.sort_order as number) - (b.sort_order as number)).map((r) => ({ id: r.id as string, name: r.name as string }))
      await loadLeaderboard()
    } catch {
      error.value = 'No fue posible cargar la quiniela.'
    } finally {
      loading.value = false
    }
  }

  async function loadLeaderboard(roundId: string | null = null): Promise<void> {
    const { data, error: rpcError } = await clientFactory().rpc('pool_leaderboard', { p_pool_id: currentPoolId, p_round_id: roundId })
    leaderboard.value = rpcError ? [] : ((data ?? []) as LeaderRow[]).map((row) => ({ ...row, points: Number(row.points) }))
  }

  /** Guarda (o edita) el pronóstico. El servidor decide el cierre; el mensaje devuelto ya está listo para mostrarse. */
  async function savePrediction(matchId: string, home: number, away: number): Promise<string | null> {
    savingMatchId.value = matchId
    try {
      const { error: rpcError } = await clientFactory().rpc('save_prediction', { p_pool_id: currentPoolId, p_match_id: matchId, p_home_score: home, p_away_score: away })
      if (rpcError) {
        await load(currentPoolId, currentProfileId)   // un rechazo suele significar que cerró: refrescar el estado real
        return humanizePredictionError(rpcError.code, rpcError.message)
      }
      await load(currentPoolId, currentProfileId)
      return null
    } finally {
      savingMatchId.value = ''
    }
  }

  return { tenantTimezone, participation, fixture, leaderboard, rounds, loading, error, savingMatchId, myRow, canPredict, load, loadLeaderboard, savePrediction }
}
