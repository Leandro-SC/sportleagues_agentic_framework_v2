import { ref } from 'vue'
import { readInChunks } from '../lib/chunks'
import { getSupabaseClient } from '../lib/supabase'
import { humanizeTicketError, type TicketRow } from '../lib/tickets'
import type { SportsAdminClient } from './useSportsAdmin'

export type Selection = { home: number; away: number; points: number | null }
type Row = Record<string, unknown>
type RpcResult = { data: unknown; error: { message: string; code?: string; hint?: string } | null }

const num = (v: unknown): number => Number(v ?? 0)

function normalize(row: Row): TicketRow {
  return {
    ticket_id: row.ticket_id as string, pool_id: row.pool_id as string, pool_name: row.pool_name as string, round_id: row.round_id as string, round_name: row.round_name as string,
    display_no: num(row.display_no), status: row.status as TicketRow['status'], eligibility: row.eligibility as TicketRow['eligibility'], created_at: row.created_at as string,
    submitted_at: (row.submitted_at as string | null) ?? null, selections: num(row.selections), round_matches: num(row.round_matches), results_count: num(row.results_count),
    points: num(row.points), is_best: Boolean(row.is_best), max_tickets: num(row.max_tickets), sales_closes_at: (row.sales_closes_at as string | null) ?? null,
  }
}

// Tickets del participante en una quiniela: historial, selecciones por ticket y acciones. Las acciones van por RPC; el cupo, el cierre y la
// elegibilidad los decide el servidor. La clave de idempotencia identifica la INTENCIÓN de emitir: se conserva si el intento falla (reintento
// seguro) y se renueva solo tras un éxito.
export function usePoolTickets(clientFactory: () => SportsAdminClient = () => getSupabaseClient() as unknown as SportsAdminClient, newKey: () => string = () => crypto.randomUUID()) {
  const tickets = ref<TicketRow[]>([])
  const selections = ref<Record<string, Record<string, Selection>>>({})   // ticketId → poolMatchId → selección
  const roundLimits = ref<Record<string, number>>({})   // jornada vendible → máximo de tickets por participante
  const loading = ref(false)
  const busy = ref('')
  const error = ref('')
  const pendingKeys = new Map<string, string>()
  let poolId = ''
  let profileId = ''

  async function select(table: string, columns: string, shape: (q: ReturnType<ReturnType<SportsAdminClient['from']>['select']>) => ReturnType<ReturnType<SportsAdminClient['from']>['select']>): Promise<Row[]> {
    const { data, error: readError } = await shape(clientFactory().from(table).select(columns))
    if (readError) throw new Error(readError.message)
    return (data ?? []) as Row[]
  }

  async function load(forPoolId: string, forProfileId: string): Promise<void> {
    poolId = forPoolId; profileId = forProfileId
    loading.value = true; error.value = ''
    try {
      const { data, error: rpcError } = await clientFactory().rpc('list_my_tickets', { p_pool_id: forPoolId })
      if (rpcError) throw new Error(rpcError.message)
      tickets.value = ((data ?? []) as Row[]).map(normalize)
      const limits = await select('pool_rounds', 'round_id, max_tickets_per_participant', (q) => q.eq('pool_id', forPoolId))
      roundLimits.value = Object.fromEntries(limits.map((l) => [l.round_id as string, num(l.max_tickets_per_participant)]))
      const [me] = await select('participants', 'id', (q) => q.eq('pool_id', forPoolId).eq('profile_id', forProfileId))
      const preds = me ? await select('predictions', 'id, ticket_id, pool_match_id, home_score, away_score', (q) => q.eq('pool_id', forPoolId).eq('participant_id', me.id as string)) : []
      const mine = preds.filter((p) => p.ticket_id)
      const events = await readInChunks(mine.map((p) => p.id as string), (batch) => select('scoring_events', 'prediction_id, points, result_revision, rule_version', (q) => q.in('prediction_id', batch)))
      const latest = (id: string): number | null => {
        const list = events.filter((e) => e.prediction_id === id).sort((a, b) => num(b.result_revision) - num(a.result_revision) || num(b.rule_version) - num(a.rule_version))
        return list.length ? num(list[0]!.points) : null
      }
      const map: Record<string, Record<string, Selection>> = {}
      for (const p of mine) (map[p.ticket_id as string] ??= {})[p.pool_match_id as string] = { home: num(p.home_score), away: num(p.away_score), points: latest(p.id as string) }
      selections.value = map
    } catch {
      error.value = 'No fue posible cargar tus tickets.'
    } finally {
      loading.value = false
    }
  }

  async function act(label: string, call: () => PromiseLike<RpcResult>): Promise<string | null> {
    busy.value = label
    try {
      const { error: rpcError } = await call()
      // A rejected write already has a safe message. Avoid a second read which, while
      // offline, would replace the ticket panel with an error and hide the retry.
      if (rpcError) return humanizeTicketError(rpcError.code, rpcError.message, rpcError.hint)
      await load(poolId, profileId)
      return null
    } catch {
      return humanizeTicketError(null, null)
    } finally {
      busy.value = ''
    }
  }

  async function createTicket(roundId: string): Promise<string | null> {
    const key = pendingKeys.get(roundId) ?? newKey()
    pendingKeys.set(roundId, key)
    const message = await act(`create:${roundId}`, () => clientFactory().rpc('create_ticket', { p_pool_id: poolId, p_round_id: roundId, p_idempotency_key: key }))
    // éxito (o clave ya consumida por el servidor) → nueva intención la próxima vez; fallo de cupo/cierre también la libera
    if (!message || /máximo|cerró|habilitad|Quien administra/.test(message)) pendingKeys.delete(roundId)
    return message
  }

  const saveSelection = (ticketId: string, matchId: string, home: number, away: number): Promise<string | null> =>
    act(`save:${ticketId}:${matchId}`, () => clientFactory().rpc('save_ticket_prediction', { p_ticket_id: ticketId, p_match_id: matchId, p_home_score: home, p_away_score: away }))
  const submitTicket = (ticketId: string): Promise<string | null> => act(`submit:${ticketId}`, () => clientFactory().rpc('submit_ticket', { p_ticket_id: ticketId }))
  const cancelTicket = (ticketId: string): Promise<string | null> => act(`cancel:${ticketId}`, () => clientFactory().rpc('cancel_ticket', { p_ticket_id: ticketId }))

  return { tickets, selections, roundLimits, loading, busy, error, load, createTicket, saveSelection, submitTicket, cancelTicket }
}

/** Historial de todas mis quinielas con tickets (pantalla «Mis tickets»). */
export function useMyTicketsHistory(clientFactory: () => SportsAdminClient = () => getSupabaseClient() as unknown as SportsAdminClient) {
  const tickets = ref<TicketRow[]>([])
  const loading = ref(false)
  const error = ref('')
  async function load(): Promise<void> {
    loading.value = true; error.value = ''
    try {
      const { data, error: rpcError } = await clientFactory().rpc('list_my_tickets', { p_pool_id: null })
      if (rpcError) { error.value = 'No fue posible cargar tus tickets.'; tickets.value = []; return }
      tickets.value = ((data ?? []) as Row[]).map(normalize)
    } catch {
      error.value = 'No fue posible cargar tus tickets.'
    } finally {
      loading.value = false
    }
  }
  return { tickets, loading, error, load }
}
