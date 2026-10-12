import { getOfflineCache, type CacheNamespace, type OfflineCache } from './offline-cache'

// Lectura «stale-while-revalidate» con deduplicación de solicitudes en vuelo (dos componentes que piden lo mismo comparten UNA petición).
//  · Dato fresco → se devuelve sin tocar la red.
//  · Dato vencido → se devuelve ya y se revalida en segundo plano (`onUpdate` recibe el valor nuevo).
//  · Sin dato → se espera la red. Si la red falla y hay dato viejo, se devuelve marcado `offline`; si no hay, el error se propaga.
// Es solo para LECTURA: jamás se usa para confirmar pronósticos, tickets o resultados.
export type SwrStatus = 'fresh' | 'revalidating' | 'offline' | 'network'
export type SwrResult<T> = { value: T; status: SwrStatus; updatedAt: number }

export type SwrOptions<T> = {
  ns: CacheNamespace
  key: string
  version: string
  ttlMs: number
  fetcher: () => Promise<T>
  onUpdate?: (result: SwrResult<T>) => void
  cache?: OfflineCache
  now?: () => number
}

const inflight = new Map<string, Promise<unknown>>()

export function resetSwrForTests(): void {
  inflight.clear()
}

function dedupe<T>(id: string, start: () => Promise<T>): Promise<T> {
  const running = inflight.get(id) as Promise<T> | undefined
  if (running) return running
  const promise = start().finally(() => { if (inflight.get(id) === promise) inflight.delete(id) })
  inflight.set(id, promise)
  return promise
}

export async function cachedRead<T>(options: SwrOptions<T>): Promise<SwrResult<T>> {
  const cache = options.cache ?? getOfflineCache()
  const now = options.now ?? Date.now
  const id = `${options.ns}|${options.key}`
  const hit = await cache.get<T>(options.ns, options.key, options.version)

  const network = () =>
    dedupe(id, async () => {
      const value = await options.fetcher()
      await cache.set(options.ns, options.key, value, { version: options.version, ttlMs: options.ttlMs })
      return value
    })

  if (hit?.fresh) return { value: hit.value, status: 'fresh', updatedAt: hit.storedAt }
  if (hit) {
    void network()
      .then((value) => options.onUpdate?.({ value, status: 'network', updatedAt: now() }))
      .catch(() => options.onUpdate?.({ value: hit.value, status: 'offline', updatedAt: hit.storedAt }))
    return { value: hit.value, status: 'revalidating', updatedAt: hit.storedAt }
  }
  // Sin dato local: se espera la red; si falla, el error se propaga (la pantalla muestra su estado de error/reintento).
  return { value: await network(), status: 'network', updatedAt: now() }
}
