// Caché de lectura privada de la quiniela (ADR-016 §7): persistente por usuario, frescura adaptativa, sin conexión y siempre
// servidor-autoritativa tras una escritura. Usa una implementación real de IndexedDB (fake-indexeddb).
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineCache, privateNamespace, purgePrivateCaches, setOfflineCacheForTests } from '../lib/offline-cache'
import { resetSwrForTests } from '../lib/swr'
import { poolCacheTtlMs, usePoolPlay } from './usePoolPlay'
import type { SportsAdminClient } from './useSportsAdmin'

type Tables = Record<string, Record<string, unknown>[]>
const future = new Date(Date.now() + 2 * 24 * 3600_000).toISOString()

function fake(tables: Tables, state: { down: boolean; delay?: number } = { down: false }) {
  let reads = 0
  const rpc = vi.fn(async () => ({ data: [], error: null }))
  const client: SportsAdminClient = {
    from: (table) => ({
      select: () => {
        reads += 1
        let rows = [...(tables[table] ?? [])]
        const query = {
          eq: (c: string, v: string) => { rows = rows.filter((r) => r[c] === v); return query },
          in: (c: string, v: string[]) => { rows = rows.filter((r) => v.includes(r[c] as string)); return query },
          order: () => query,
          then: (resolve: (value: unknown) => unknown) => new Promise((r) => setTimeout(r, state.delay ?? 0)).then(() => state.down ? { data: null, error: { message: 'network' } } : { data: rows, error: null }).then(resolve),
        }
        return query as never
      },
    }),
    rpc,
  }
  return { client, rpc, reads: () => reads }
}
const tables = (): Tables => ({
  pools: [{ id: 'p1', tenant_id: 't1' }],
  tenants: [{ id: 't1', timezone: 'America/Lima' }],
  participants: [{ id: 'part-me', pool_id: 'p1', profile_id: 'me', approval_status: 'approved', withdrawn_at: null }],
  pool_matches: [{ id: 'pm1', pool_id: 'p1', match_id: 'm1', lock_at: future }],
  matches: [{ id: 'm1', round_id: 'r1', home_team_id: 'a', away_team_id: 'b', starts_at: future, status: 'scheduled' }],
  teams: [{ id: 'a', name: 'Alianza', short_name: null }, { id: 'b', name: 'Cristal', short_name: null }],
  rounds: [{ id: 'r1', name: 'Fecha 1', sort_order: 1 }],
  official_results: [], predictions: [], scoring_events: [],
})

let cache: OfflineCache
const clock = { t: 20_000_000 }
beforeEach(() => { resetSwrForTests(); clock.t = 20_000_000; cache = new OfflineCache({ idb: new IDBFactory() }); setOfflineCacheForTests(cache) })
afterEach(() => setOfflineCacheForTests(null))

describe('usePoolPlay con caché privada', () => {
  it('la primera carga va al servidor; la segunda (dentro de la frescura) no hace ninguna lectura', async () => {
    const a = fake(tables())
    await usePoolPlay(() => a.client).load('p1', 'me')
    const afterFirst = a.reads()
    expect(afterFirst).toBeGreaterThan(0)
    const second = usePoolPlay(() => a.client)
    await second.load('p1', 'me')
    expect(a.reads()).toBe(afterFirst)
    expect(second.fromCache.value).toBe(true)
    expect(second.fixture.value[0]).toMatchObject({ homeName: 'Alianza', lockAt: future })
    expect(second.loading.value).toBe(false)
  })

  it('cada usuario tiene su propia caché: otra identidad no ve los datos del primero', async () => {
    const a = fake(tables())
    await usePoolPlay(() => a.client).load('p1', 'me')
    const other = usePoolPlay(() => a.client)
    const before = a.reads()
    await other.load('p1', 'otro-usuario')
    expect(a.reads()).toBeGreaterThan(before) // fue al servidor
    expect(other.fromCache.value).toBe(false)
    expect(other.participation.value).toBe('none') // el estado real de ESE usuario, no el del anterior
  })

  it('vencida la frescura muestra lo guardado al instante y revalida; sin conexión conserva y avisa', async () => {
    const state = { down: false }
    const a = fake(tables(), state)
    await usePoolPlay(() => a.client).load('p1', 'me')
    // envejecer la entrada: se vuelve a guardar con TTL 0 → obsoleta
    const hit = await cache.get<unknown>(privateNamespace('me'), 'pool:p1', 'pool-play-v1')
    await cache.set(privateNamespace('me'), 'pool:p1', hit!.value, { version: 'pool-play-v1', ttlMs: -1 })
    state.down = true
    const offline = usePoolPlay(() => a.client)
    await offline.load('p1', 'me')
    expect(offline.error.value).toBe('') // no es un error bloqueante
    expect(offline.offline.value).toBe(true)
    expect(offline.fixture.value).toHaveLength(1)
    expect(offline.updatedAt.value).not.toBeNull()
  })

  it('sin caché y sin conexión muestra el error habitual', async () => {
    const a = fake(tables(), { down: true })
    const play = usePoolPlay(() => a.client)
    await play.load('p1', 'me')
    expect(play.error.value).toBe('No fue posible cargar la quiniela.')
  })

  it('guardar un pronóstico fuerza la lectura del servidor (nunca se confirma ni se muestra desde la caché)', async () => {
    const a = fake(tables())
    const play = usePoolPlay(() => a.client)
    await play.load('p1', 'me')
    const before = a.reads()
    expect(await play.savePrediction('m1', 1, 0)).toBeNull()
    expect(a.rpc).toHaveBeenCalledWith('save_prediction', { p_pool_id: 'p1', p_match_id: 'm1', p_home_score: 1, p_away_score: 0 })
    expect(a.reads()).toBeGreaterThan(before)
    expect(play.fromCache.value).toBe(false)
  })

  it('cerrar sesión borra la caché privada', async () => {
    const a = fake(tables())
    await usePoolPlay(() => a.client).load('p1', 'me')
    await purgePrivateCaches()
    expect(await cache.get(privateNamespace('me'), 'pool:p1', 'pool-play-v1')).toBeNull()
  })

  it('dos componentes que cargan la misma quiniela a la vez comparten una sola ronda de lecturas', async () => {
    const single = fake(tables(), { down: false, delay: 8 })
    await usePoolPlay(() => single.client).load('p1', 'me')
    setOfflineCacheForTests(new OfflineCache({ idb: new IDBFactory() })); resetSwrForTests()
    const a = fake(tables(), { down: false, delay: 8 })
    const one = usePoolPlay(() => a.client)
    const two = usePoolPlay(() => a.client)
    await Promise.all([one.load('p1', 'me'), two.load('p1', 'me')])
    expect(a.reads()).toBe(single.reads())
    expect(two.fixture.value).toHaveLength(1)
  })
})

describe('frecuencia de actualización diferenciada', () => {
  it('partidos en juego o por empezar: 1 minuto; datos estables: 10 minutos', () => {
    const now = Date.parse('2026-10-12T12:00:00Z')
    expect(poolCacheTtlMs([{ status: 'live', startsAt: '2026-10-12T11:00:00Z' }], now)).toBe(60_000)
    expect(poolCacheTtlMs([{ status: 'scheduled', startsAt: '2026-10-12T13:00:00Z' }], now)).toBe(60_000)
    expect(poolCacheTtlMs([{ status: 'scheduled', startsAt: '2026-10-20T13:00:00Z' }], now)).toBe(600_000)
    expect(poolCacheTtlMs([{ status: 'final', startsAt: '2026-10-10T13:00:00Z' }], now)).toBe(600_000)
    expect(poolCacheTtlMs([], now)).toBe(600_000)
  })
})
