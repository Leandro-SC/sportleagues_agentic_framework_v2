// Pruebas de la caché persistente con una implementación real de IndexedDB (fake-indexeddb) en memoria.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { OfflineCache, privateNamespace } from './offline-cache'

function setup(options: { maxBytes?: number; maxEntries?: number } = {}) {
  const clock = { t: 1_000_000 }
  const cache = new OfflineCache({ idb: new IDBFactory(), now: () => clock.t, ...options })
  return { cache, clock }
}
const HOUR = 3600 * 1000

describe('OfflineCache', () => {
  it('guarda y recupera un valor fresco', async () => {
    const { cache } = setup()
    expect(await cache.set('public', 'k', { a: 1 }, { version: 'v1', ttlMs: HOUR })).toBe(true)
    expect(await cache.get('public', 'k', 'v1')).toMatchObject({ value: { a: 1 }, fresh: true })
  })

  it('expira: vencido sigue disponible como «obsoleto» y pasada la ventana se descarta', async () => {
    const { cache, clock } = setup()
    await cache.set('public', 'k', 'x', { version: 'v1', ttlMs: HOUR })
    clock.t += 2 * HOUR
    expect(await cache.get('public', 'k', 'v1')).toMatchObject({ value: 'x', fresh: false })
    clock.t += 8 * 24 * HOUR
    expect(await cache.get('public', 'k', 'v1')).toBeNull()
    expect((await cache.stats()).entries).toBe(0)
  })

  it('invalida por versión de esquema', async () => {
    const { cache } = setup()
    await cache.set('public', 'k', 'x', { version: 'v1', ttlMs: HOUR })
    expect(await cache.get('public', 'k', 'v2')).toBeNull()
  })

  it('separa los datos privados por usuario y tenant', async () => {
    const { cache } = setup()
    const a = privateNamespace('user-a', 'tenant-1')
    const b = privateNamespace('user-b', 'tenant-1')
    const a2 = privateNamespace('user-a', 'tenant-2')
    await cache.set(a, 'tickets', ['A'], { version: 'v1', ttlMs: HOUR })
    expect(await cache.get(b, 'tickets', 'v1')).toBeNull()
    expect(await cache.get(a2, 'tickets', 'v1')).toBeNull()
    expect((await cache.get(a, 'tickets', 'v1'))?.value).toEqual(['A'])
  })

  it('cerrar sesión borra todo lo privado y conserva el catálogo público', async () => {
    const { cache } = setup()
    await cache.set('public', 'catalog', 'c', { version: 'v1', ttlMs: HOUR })
    await cache.set(privateNamespace('u1'), 'x', 1, { version: 'v1', ttlMs: HOUR })
    await cache.set(privateNamespace('u2', 't'), 'y', 2, { version: 'v1', ttlMs: HOUR })
    await cache.clearPrivate()
    expect(await cache.get('public', 'catalog', 'v1')).not.toBeNull()
    expect(await cache.get(privateNamespace('u1'), 'x', 'v1')).toBeNull()
    expect(await cache.get(privateNamespace('u2', 't'), 'y', 'v1')).toBeNull()
  })

  it('al cambiar de usuario solo sobrevive el nuevo usuario y lo público', async () => {
    const { cache } = setup()
    await cache.set(privateNamespace('old'), 'x', 1, { version: 'v1', ttlMs: HOUR })
    await cache.set(privateNamespace('new', 't'), 'y', 2, { version: 'v1', ttlMs: HOUR })
    await cache.clearPrivate('new')
    expect(await cache.get(privateNamespace('old'), 'x', 'v1')).toBeNull()
    expect(await cache.get(privateNamespace('new', 't'), 'y', 'v1')).not.toBeNull()
  })

  it('no confunde prefijos de usuario (u:1 vs u:10)', async () => {
    const { cache } = setup()
    await cache.set(privateNamespace('1'), 'x', 1, { version: 'v1', ttlMs: HOUR })
    await cache.set(privateNamespace('10'), 'x', 10, { version: 'v1', ttlMs: HOUR })
    await cache.clearPrivate('1')
    expect(await cache.get(privateNamespace('10'), 'x', 'v1')).toBeNull()
    expect(await cache.get(privateNamespace('1'), 'x', 'v1')).not.toBeNull()
  })

  it('respeta el límite de entradas con desalojo LRU (lo usado recientemente se conserva)', async () => {
    const { cache, clock } = setup({ maxEntries: 3 })
    for (const key of ['a', 'b', 'c']) { clock.t += 10; await cache.set('public', key, key, { version: 'v1', ttlMs: HOUR }) }
    clock.t += 10
    await cache.get('public', 'a', 'v1') // toca «a»
    await new Promise((r) => setTimeout(r, 5))
    clock.t += 10
    await cache.set('public', 'd', 'd', { version: 'v1', ttlMs: HOUR })
    expect(await cache.get('public', 'b', 'v1')).toBeNull() // el menos reciente
    expect(await cache.get('public', 'a', 'v1')).not.toBeNull()
    expect((await cache.stats()).entries).toBe(3)
  })

  it('respeta el límite de bytes y rechaza un valor que acapara la caché', async () => {
    const { cache } = setup({ maxBytes: 1000 })
    expect(await cache.set('public', 'big', 'x'.repeat(900), { version: 'v1', ttlMs: HOUR })).toBe(false)
    for (let i = 0; i < 6; i++) await cache.set('public', `k${i}`, 'y'.repeat(200), { version: 'v1', ttlMs: HOUR })
    expect((await cache.stats()).bytes).toBeLessThanOrEqual(1000)
  })

  it('purgeExpired elimina lo vencido fuera de la ventana', async () => {
    const { cache, clock } = setup()
    await cache.set('public', 'old', 1, { version: 'v1', ttlMs: HOUR })
    clock.t += 9 * 24 * HOUR
    await cache.set('public', 'new', 2, { version: 'v1', ttlMs: HOUR })
    expect(await cache.purgeExpired()).toBe(1)
    expect((await cache.stats()).entries).toBe(1)
  })

  it('sin IndexedDB se desactiva sin lanzar errores', async () => {
    const cache = new OfflineCache({ idb: null })
    expect(cache.available).toBe(false)
    expect(await cache.set('public', 'k', 1, { version: 'v1', ttlMs: HOUR })).toBe(false)
    expect(await cache.get('public', 'k', 'v1')).toBeNull()
    await expect(cache.clearPrivate()).resolves.toBeUndefined()
  })

  it('si IndexedDB falla al abrir (modo privado, bloqueo) la caché es prescindible', async () => {
    const broken = { open() { throw new Error('SecurityError') } } as unknown as IDBFactory
    const cache = new OfflineCache({ idb: broken })
    expect(await cache.set('public', 'k', 1, { version: 'v1', ttlMs: HOUR })).toBe(false)
    expect(await cache.get('public', 'k', 'v1')).toBeNull()
  })

  it('un valor no serializable no rompe', async () => {
    const { cache } = setup()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(cache.set('public', 'c', circular, { version: 'v1', ttlMs: HOUR })).resolves.toBeDefined()
  })
})
