import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfflineCache, privateNamespace } from './offline-cache'
import { cachedRead, resetSwrForTests, type SwrResult } from './swr'

const HOUR = 3600 * 1000
let clock = { t: 5_000_000 }
let cache: OfflineCache
beforeEach(() => {
  resetSwrForTests()
  clock = { t: 5_000_000 }
  cache = new OfflineCache({ idb: new IDBFactory(), now: () => clock.t })
})
const read = <T>(fetcher: () => Promise<T>, extra: Partial<Parameters<typeof cachedRead<T>>[0]> = {}) =>
  cachedRead<T>({ ns: 'public', key: 'k', version: 'v1', ttlMs: HOUR, fetcher, cache, now: () => clock.t, ...extra })

describe('lectura con caché (stale-while-revalidate)', () => {
  it('el primer acceso va a la red y el segundo, dentro del TTL, no', async () => {
    const fetcher = vi.fn(async () => 'dato')
    expect((await read(fetcher)).status).toBe('network')
    expect((await read(fetcher)).status).toBe('fresh')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('deduplica solicitudes simultáneas entre componentes (una sola petición)', async () => {
    const fetcher = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return 42 })
    const results = await Promise.all(Array.from({ length: 10 }, () => read(fetcher)))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(results.every((r) => r.value === 42)).toBe(true)
  })

  it('vencido: devuelve lo guardado al instante y revalida en segundo plano', async () => {
    await read(async () => 'viejo')
    clock.t += 2 * HOUR
    const updates: SwrResult<string>[] = []
    const result = await read(async () => 'nuevo', { onUpdate: (u) => updates.push(u) })
    expect(result).toMatchObject({ value: 'viejo', status: 'revalidating' })
    await vi.waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({ value: 'nuevo', status: 'network' })
    expect(await read(async () => 'otro')).toMatchObject({ value: 'nuevo', status: 'fresh' })
  })

  it('sin conexión: conserva el dato viejo y avisa «offline» con su fecha', async () => {
    await read(async () => 'guardado')
    const storedAt = clock.t
    clock.t += 3 * HOUR
    const updates: SwrResult<string>[] = []
    const result = await read(async () => { throw new Error('network down') }, { onUpdate: (u) => updates.push(u) })
    expect(result.value).toBe('guardado')
    await vi.waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({ value: 'guardado', status: 'offline', updatedAt: storedAt })
  })

  it('sin dato local y sin red: propaga el error (estado de error en pantalla)', async () => {
    await expect(read(async () => { throw new Error('down') })).rejects.toThrow('down')
  })

  it('los datos privados de un usuario no se sirven a otro', async () => {
    const fetchA = vi.fn(async () => ['ticket de A'])
    const fetchB = vi.fn(async () => ['ticket de B'])
    await read(fetchA, { ns: privateNamespace('A', 't1'), key: 'tickets' })
    const b = await read(fetchB, { ns: privateNamespace('B', 't1'), key: 'tickets' })
    expect(b.value).toEqual(['ticket de B'])
    expect(fetchB).toHaveBeenCalledTimes(1)
  })

  it('cambiar la versión invalida lo guardado', async () => {
    await read(async () => 'v1-data')
    const fetcher = vi.fn(async () => 'v2-data')
    expect((await read(fetcher, { version: 'v2' })).value).toBe('v2-data')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('si la caché no está disponible, funciona igual consultando siempre la red', async () => {
    const off = new OfflineCache({ idb: null })
    const fetcher = vi.fn(async () => 1)
    await cachedRead({ ns: 'public', key: 'k', version: 'v', ttlMs: HOUR, fetcher, cache: off })
    await cachedRead({ ns: 'public', key: 'k', version: 'v', ttlMs: HOUR, fetcher, cache: off })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
