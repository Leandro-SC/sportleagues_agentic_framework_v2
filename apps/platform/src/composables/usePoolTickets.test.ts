import { describe, expect, it, vi } from 'vitest'
import { useMyTicketsHistory, usePoolTickets } from './usePoolTickets'
import type { SportsAdminClient } from './useSportsAdmin'

type Tables = Record<string, Record<string, unknown>[]>
const ticketRow = (over: Record<string, unknown> = {}) => ({ ticket_id: 't1', pool_id: 'p1', pool_name: 'Liga', round_id: 'r1', round_name: 'Fecha 1', display_no: 1, status: 'draft', eligibility: 'pending',
  created_at: '2026-10-12T10:00:00Z', submitted_at: null, selections: 1, round_matches: 2, results_count: 0, points: '0', is_best: false, max_tickets: 2, sales_closes_at: '2026-10-12T15:00:00Z', ...over })

type RpcReply = { data?: unknown; error?: { message: string; code?: string; hint?: string } | null }

function fake(tables: Tables, rpcImpl: (fn: string, args: Record<string, unknown>) => RpcReply = () => ({})) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => ({ data: fn === 'list_my_tickets' ? [ticketRow()] : null, error: null, ...rpcImpl(fn, args) }))
  const client: SportsAdminClient = {
    from: (table) => ({
      select: () => {
        let rows = [...(tables[table] ?? [])]
        const q = {
          eq: (c: string, v: string) => { rows = rows.filter((r) => r[c] === v); return q },
          in: (c: string, v: string[]) => { rows = rows.filter((r) => v.includes(r[c] as string)); return q },
          order: () => q,
          then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
        }
        return q as never
      },
    }),
    rpc,
  }
  return { client, rpc }
}

const tables: Tables = {
  participants: [{ id: 'part', pool_id: 'p1', profile_id: 'me' }],
  predictions: [
    { id: 'x1', pool_id: 'p1', participant_id: 'part', ticket_id: 't1', pool_match_id: 'pm1', home_score: 2, away_score: 1 },
    { id: 'x2', pool_id: 'p1', participant_id: 'part', ticket_id: null, pool_match_id: 'pm9', home_score: 0, away_score: 0 },
    { id: 'x3', pool_id: 'p1', participant_id: 'otro', ticket_id: 't9', pool_match_id: 'pm1', home_score: 5, away_score: 5 },
  ],
  scoring_events: [{ prediction_id: 'x1', points: 2, result_revision: 1, rule_version: 1 }, { prediction_id: 'x1', points: 5, result_revision: 2, rule_version: 1 }],
}

describe('usePoolTickets', () => {
  it('carga el historial normalizado y las selecciones por ticket con los puntos de la revisión más reciente', async () => {
    const { client } = fake(tables)
    const t = usePoolTickets(() => client)
    await t.load('p1', 'me')
    expect(t.error.value).toBe('')
    expect(t.tickets.value[0]).toMatchObject({ ticket_id: 't1', display_no: 1, points: 0, max_tickets: 2 })
    // no entra el pronóstico clásico (sin ticket) ni el de otro participante
    expect(t.selections.value).toEqual({ t1: { pm1: { home: 2, away: 1, points: 5 } } })
  })

  it('emite con una clave de idempotencia que se CONSERVA ante un fallo de red y se renueva tras el éxito', async () => {
    let n = 0
    let fail = true
    const { client, rpc } = fake(tables, (fn) => (fn === 'create_ticket' && fail ? { error: { message: 'fetch failed' } } : {}))
    const t = usePoolTickets(() => client, () => `key-${++n}`)
    await t.load('p1', 'me')
    expect(await t.createTicket('r1')).toMatch(/Inténtalo/)
    fail = false
    expect(await t.createTicket('r1')).toBeNull()
    const keys = () => rpc.mock.calls.filter(([fn]) => fn === 'create_ticket').map(([, a]) => a.p_idempotency_key)
    expect(keys()).toEqual(['key-1', 'key-1'])
    expect(await t.createTicket('r1')).toBeNull()
    expect(keys().at(-1)).toBe('key-2')
  })

  it('traduce el límite de tickets y libera la clave para no reintentar lo imposible', async () => {
    let n = 0
    const { client } = fake(tables, (fn) => (fn === 'create_ticket' ? { error: { message: 'ticket limit reached for this round', code: '42501', hint: 'TICKET_LIMIT' } } : {}))
    const t = usePoolTickets(() => client, () => `k${++n}`)
    await t.load('p1', 'me')
    expect(await t.createTicket('r1')).toMatch(/máximo/)
    await t.createTicket('r1')
    expect(n).toBe(2)
  })

  it('guarda, envía y cancela por RPC y refresca el estado tras cada acción', async () => {
    const { client, rpc } = fake(tables)
    const t = usePoolTickets(() => client)
    await t.load('p1', 'me')
    const lists = () => rpc.mock.calls.filter(([fn]) => fn === 'list_my_tickets').length
    const before = lists()
    expect(await t.saveSelection('t1', 'm1', 2, 1)).toBeNull()
    expect(await t.submitTicket('t1')).toBeNull()
    expect(await t.cancelTicket('t1')).toBeNull()
    expect(rpc).toHaveBeenCalledWith('save_ticket_prediction', { p_ticket_id: 't1', p_match_id: 'm1', p_home_score: 2, p_away_score: 1 })
    expect(rpc).toHaveBeenCalledWith('submit_ticket', { p_ticket_id: 't1' })
    expect(rpc).toHaveBeenCalledWith('cancel_ticket', { p_ticket_id: 't1' })
    expect(lists()).toBe(before + 3)
  })

  it('un cierre de venta se muestra en español y el estado se recarga', async () => {
    const { client, rpc } = fake(tables, (fn) => (fn === 'submit_ticket' ? { error: { message: 'ticket sales for this round are closed', code: '42501' } } : {}))
    const t = usePoolTickets(() => client)
    await t.load('p1', 'me')
    expect(await t.submitTicket('t1')).toMatch(/cerró/)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'list_my_tickets').length).toBe(2)
  })

  it('error de lectura: mensaje genérico', async () => {
    const broken = { from: () => { throw new Error('boom') }, rpc: vi.fn(async () => ({ data: [], error: null })) } as unknown as SportsAdminClient
    const t = usePoolTickets(() => broken)
    await t.load('p1', 'me')
    expect(t.error.value).toBe('No fue posible cargar tus tickets.')
  })
})

describe('useMyTicketsHistory', () => {
  it('lista los tickets de todas las quinielas con tickets', async () => {
    const { client, rpc } = fake({})
    const h = useMyTicketsHistory(() => client)
    await h.load()
    expect(rpc).toHaveBeenCalledWith('list_my_tickets', { p_pool_id: null })
    expect(h.tickets.value).toHaveLength(1)
  })

  it('con error devuelve un mensaje y la lista vacía', async () => {
    const h = useMyTicketsHistory(() => fake({}, () => ({ error: { message: 'x' } })).client)
    await h.load()
    expect(h.error.value).toBe('No fue posible cargar tus tickets.')
    expect(h.tickets.value).toEqual([])
  })
})
