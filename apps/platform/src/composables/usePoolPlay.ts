import { computed, ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import { humanizePredictionError } from '../lib/prediction-ux'
import { describeSuggestionError, parseSuggestion, type ScorelineSuggestion } from '../lib/scoreline-suggestion'
import { getOfflineCache, privateNamespace } from '../lib/offline-cache'
import { readInChunks } from '../lib/chunks'
import { dedupe } from '../lib/swr'
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

// Caché de lectura PRIVADA por usuario (ADR-016 §7): la última vista de la quiniela se muestra al instante y sin conexión; el servidor
// sigue decidiendo cierres y pronósticos. No incluye pronósticos ajenos (solo los revelados por RLS ya viven en la tabla). Frecuencias
// diferenciadas: 1 min si hay partidos en juego o por empezar, 10 min si no.
const POOL_CACHE_VERSION = 'pool-play-v1'
type PoolSnapshot = {
  tenantTimezone: string; ticketMode: 'none' | 'tickets'; participation: Participation
  fixture: FixtureItem[]; rounds: { id: string; name: string }[]; leaderboard: LeaderRow[]
}
export function poolCacheTtlMs(fixture: Pick<FixtureItem, 'status' | 'startsAt'>[], now = Date.now()): number {
  const active = fixture.some((item) => item.status === 'live' || (item.status === 'scheduled' && Date.parse(item.startsAt) - now < 3 * 3600_000))
  return active ? 60_000 : 10 * 60_000
}

// Experiencia del participante (Fase 07/08): parrilla del pool con el lock que persiste el servidor, mis pronósticos, resultados y
// tabla. Solo lectura bajo RLS + RPC `save_prediction` / `pool_leaderboard`; el cliente nunca decide permisos ni cierres.
//
// `currentUserId` (FE-05): id del usuario autenticado AHORA. Las lecturas se hacen con el JWT vigente en cada momento; si entre el
// inicio y el fin de una carga la identidad cambia (otra pestaña inicia sesión con otra cuenta), lo leído NO se pinta ni se escribe en
// la caché privada `u:<profileId>` del usuario anterior. Sin getter (tests) no se comprueba.
export function usePoolPlay(
  clientFactory: () => SportsAdminClient = () => getSupabaseClient() as unknown as SportsAdminClient,
  currentUserId?: () => string | null | undefined,
) {
  const tenantTimezone = ref('UTC')
  const ticketMode = ref<'none' | 'tickets'>('none')
  const participation = ref<Participation>('none')
  const fixture = ref<FixtureItem[]>([])
  const leaderboard = ref<LeaderRow[]>([])
  const rounds = ref<{ id: string; name: string }[]>([])
  const loading = ref(false)
  const error = ref('')
  const savingMatchId = ref('')
  const suggestingPoolMatchId = ref('')
  const suggestAvailable = ref(true)
  const fromCache = ref(false)
  const offline = ref(false)
  const updatedAt = ref<number | null>(null)
  let currentPoolId = ''
  let currentProfileId = ''
  let loadToken = 0

  const myRow = computed(() => leaderboard.value.find((row) => row.is_me) ?? null)
  const canPredict = computed(() => participation.value === 'participant')

  async function rows(table: string, columns: string, shape: (q: ReturnType<ReturnType<SportsAdminClient['from']>['select']>) => ReturnType<ReturnType<SportsAdminClient['from']>['select']>): Promise<Row[]> {
    const { data, error: readError } = await shape(clientFactory().from(table).select(columns))
    if (readError) throw new Error(readError.message)
    return (data ?? []) as Row[]
  }

  // Filtros `.in()` troceados en lotes de 100 ids (FE-11): evita URL gigantes con parrillas de cientos de partidos.
  const rowsIn = (table: string, columns: string, column: string, ids: readonly string[]): Promise<Row[]> =>
    readInChunks(ids, (batch) => rows(table, columns, (q) => q.in(column, batch)))

  async function fetchSnapshot(poolId: string, profileId: string): Promise<PoolSnapshot> {
    const [pool] = await rows('pools', 'id, tenant_id, ticketing_mode', (q) => q.eq('id', poolId))
    const ticketModeNext: 'none' | 'tickets' = pool?.ticketing_mode === 'tickets' ? 'tickets' : 'none'
    let timezone = 'UTC'
    if (pool) {
      const [tenant] = await rows('tenants', 'timezone', (q) => q.eq('id', pool.tenant_id as string))
      timezone = (tenant?.timezone as string | undefined) ?? 'UTC'
    }
    const [me] = await rows('participants', 'id, approval_status, withdrawn_at', (q) => q.eq('pool_id', poolId).eq('profile_id', profileId))
    const participationNext: Participation = !me || me.withdrawn_at ? 'none' : me.approval_status === 'approved' ? 'participant' : 'pending'

    const poolMatches = await rows('pool_matches', 'id, match_id, lock_at', (q) => q.eq('pool_id', poolId))
    const matchIds = poolMatches.map((row) => row.match_id as string)
    const matches = await rowsIn('matches', 'id, round_id, home_team_id, away_team_id, starts_at, status', 'id', matchIds)
    const teamIds = [...new Set(matches.flatMap((m) => [m.home_team_id as string, m.away_team_id as string]))]
    const roundIds = [...new Set(matches.map((m) => m.round_id as string))]
    const [teams, roundRows, results, predictions] = await Promise.all([
      rowsIn('teams', 'id, name, short_name', 'id', teamIds),
      rowsIn('rounds', 'id, name, sort_order', 'id', roundIds),
      rowsIn('official_results', 'match_id, home_score, away_score, revision', 'match_id', matchIds),
      me ? rows('predictions', 'id, pool_match_id, home_score, away_score, ticket_id', (q) => q.eq('pool_id', poolId).eq('participant_id', me.id as string)).then((list) => list.filter((p) => !p.ticket_id)) : Promise.resolve([]),   // con tickets, los pronósticos viven en el ticket (usePoolTickets)
    ])
    const predictionIds = predictions.map((p) => p.id as string)
    const events = await rowsIn('scoring_events', 'prediction_id, points, result_revision, rule_version', 'prediction_id', predictionIds)

    const team = new Map(teams.map((t) => [t.id as string, t]))
    const round = new Map(roundRows.map((r) => [r.id as string, r]))
    const result = new Map(results.map((r) => [r.match_id as string, r]))
    const prediction = new Map(predictions.map((p) => [p.pool_match_id as string, p]))
    const latestPoints = (predictionId: string): number | null => {
      const mine = events.filter((e) => e.prediction_id === predictionId)
        .sort((a, b) => (b.result_revision as number) - (a.result_revision as number) || (b.rule_version as number) - (a.rule_version as number))
      return mine.length ? (mine[0]!.points as number) : null
    }

    const fixtureNext = poolMatches.flatMap((pm): FixtureItem[] => {
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
    const roundsNext = [...round.values()].sort((a, b) => (a.sort_order as number) - (b.sort_order as number)).map((r) => ({ id: r.id as string, name: r.name as string }))
    const { data, error: rpcError } = await clientFactory().rpc('pool_leaderboard', { p_pool_id: poolId, p_round_id: null })
    const leaderboardNext = rpcError ? [] : ((data ?? []) as LeaderRow[]).map((row) => ({ ...row, points: Number(row.points) }))
    return { tenantTimezone: timezone, ticketMode: ticketModeNext, participation: participationNext, fixture: fixtureNext, rounds: roundsNext, leaderboard: leaderboardNext }
  }

  function apply(snapshot: PoolSnapshot): void {
    tenantTimezone.value = snapshot.tenantTimezone; ticketMode.value = snapshot.ticketMode; participation.value = snapshot.participation
    fixture.value = snapshot.fixture; rounds.value = snapshot.rounds; leaderboard.value = snapshot.leaderboard
  }

  /**
   * Carga la quiniela. Con caché privada disponible: pinta al instante lo último guardado y revalida (o no toca la red si sigue fresco).
   * `force` (tras guardar un pronóstico) ignora la caché: lo que se muestre después de una escritura viene siempre del servidor.
   */
  const sameIdentity = (profileId: string): boolean => !currentUserId || currentUserId() === profileId

  /** Vacía lo mostrado (cambio de identidad): ningún dato del usuario anterior queda en pantalla. */
  function reset(): void {
    loadToken++
    tenantTimezone.value = 'UTC'; ticketMode.value = 'none'; participation.value = 'none'
    fixture.value = []; leaderboard.value = []; rounds.value = []
    loading.value = false; error.value = ''; fromCache.value = false; offline.value = false; updatedAt.value = null
    savingMatchId.value = ''; suggestingPoolMatchId.value = ''
    currentPoolId = ''; currentProfileId = ''
  }

  /** `background` (actualización en vivo): fuerza la red pero no muestra el estado de carga si ya hay datos en pantalla. */
  async function load(poolId: string, profileId: string, options: { force?: boolean; background?: boolean } = {}): Promise<void> {
    currentPoolId = poolId; currentProfileId = profileId
    const token = ++loadToken
    error.value = ''
    const cache = getOfflineCache()
    const cacheGeneration = cache.privateGeneration // FE-10: una purga (cierre de sesión) durante la lectura invalida la escritura
    const ns = privateNamespace(profileId)
    const key = `pool:${poolId}`
    let painted = Boolean(options.background) && fixture.value.length > 0
    if (!options.force && !options.background) {
      const hit = await cache.get<PoolSnapshot>(ns, key, POOL_CACHE_VERSION)
      if (token !== loadToken || !sameIdentity(profileId)) return
      if (hit) {
        apply(hit.value); painted = true; fromCache.value = true; updatedAt.value = hit.storedAt
        // A pending enrolment may be approved while this view is cached. Revalidate it
        // so prediction access is restored without waiting for the cache TTL.
        if (hit.fresh && hit.value.participation === 'participant') { offline.value = false; return }
      }
    }
    loading.value = !painted
    try {
      // Dos componentes que piden la misma quiniela a la vez comparten UNA ronda de lecturas.
      const snapshot = await dedupe(`${ns}|${key}`, () => fetchSnapshot(poolId, profileId))
      // El snapshot se leyó con el JWT vigente durante la lectura: si ya es otra identidad, no es de `profileId`.
      if (token !== loadToken || !sameIdentity(profileId)) return
      apply(snapshot)
      fromCache.value = false; offline.value = false; updatedAt.value = Date.now()
      await cache.set(ns, key, snapshot, { version: POOL_CACHE_VERSION, ttlMs: poolCacheTtlMs(snapshot.fixture), generation: cacheGeneration })
    } catch {
      if (token !== loadToken || !sameIdentity(profileId)) return
      if (painted) offline.value = true // se conserva lo guardado y se avisa; no es un error bloqueante
      else error.value = 'No fue posible cargar la quiniela.'
    } finally {
      if (token === loadToken) loading.value = false
    }
  }

  async function loadLeaderboard(roundId: string | null = null): Promise<void> {
    const profileId = currentProfileId
    const { data, error: rpcError } = await clientFactory().rpc('pool_leaderboard', { p_pool_id: currentPoolId, p_round_id: roundId })
    if (!sameIdentity(profileId)) return
    leaderboard.value = rpcError ? [] : ((data ?? []) as LeaderRow[]).map((row) => ({ ...row, points: Number(row.points) }))
  }

  /** Guarda (o edita) el pronóstico. El servidor decide el cierre; el mensaje devuelto ya está listo para mostrarse. */
  async function savePrediction(matchId: string, home: number, away: number): Promise<string | null> {
    // La quiniela en pantalla es de otra identidad: no se escribe con el JWT nuevo (FE-05).
    if (!sameIdentity(currentProfileId)) return 'Tu sesión cambió. Vuelve a abrir la quiniela para continuar.'
    savingMatchId.value = matchId
    try {
      const { error: rpcError } = await clientFactory().rpc('save_prediction', { p_pool_id: currentPoolId, p_match_id: matchId, p_home_score: home, p_away_score: away })
      if (rpcError) {
        await load(currentPoolId, currentProfileId, { force: true })   // un rechazo suele significar que cerró: refrescar el estado real
        return humanizePredictionError(rpcError.code, rpcError.message)
      }
      await load(currentPoolId, currentProfileId, { force: true })
      return null
    } finally {
      savingMatchId.value = ''
    }
  }

  /**
   * Pide al servidor la sugerencia estadística (Elo + Poisson, ADR-019). Solo lectura: no se guarda en caché ni escribe nada; el cliente
   * únicamente rellena el formulario y guardar sigue pasando por `save_prediction`. Si el RPC no existe en este entorno se oculta la función.
   */
  async function suggestScoreline(poolMatchId: string): Promise<{ suggestion: ScorelineSuggestion } | { failure: string }> {
    if (!suggestAvailable.value) return { failure: 'La sugerencia estadística aún no está disponible en este entorno.' }
    suggestingPoolMatchId.value = poolMatchId
    try {
      const { data, error: rpcError } = await clientFactory().rpc('suggest_scoreline', { p_pool_match_id: poolMatchId })
      if (rpcError) {
        const failure = describeSuggestionError(rpcError as { code?: string; message?: string; hint?: string; details?: string })
        if (failure.unavailable) suggestAvailable.value = false
        return { failure: failure.message }
      }
      const suggestion = parseSuggestion(data)
      return suggestion ? { suggestion } : { failure: 'No pudimos calcular la sugerencia. Inténtalo de nuevo.' }
    } catch {
      return { failure: 'Sin conexión: la sugerencia necesita conexión con el servidor.' }
    } finally {
      suggestingPoolMatchId.value = ''
    }
  }

  return { tenantTimezone, ticketMode, participation, fixture, leaderboard, rounds, loading, error, savingMatchId, myRow, canPredict, fromCache, offline, updatedAt, suggestAvailable, suggestingPoolMatchId, load, reset, loadLeaderboard, savePrediction, suggestScoreline }
}
