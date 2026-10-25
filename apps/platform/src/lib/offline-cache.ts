// Caché local persistente (IndexedDB) para lectura (ADR-016 §7). Justificación de IndexedDB: antes solo existía localStorage para banderas
// pequeñas; el catálogo, jornadas y clasificaciones son datos estructurados y de cientos de KB.
//
// Reglas:
//  · Solo LECTURA. Ninguna escritura competitiva (pronóstico, ticket, resultado) se confirma ni se encola aquí; el servidor decide siempre.
//  · Espacios de nombres: `public` (catálogo global, sin datos personales) y `u:<userId>[:t:<tenantId>]` (datos privados). Cerrar sesión o
//    cambiar de usuario borra todo lo que no sea `public`. Nunca se guardan credenciales ni tokens.
//  · Cada entrada lleva versión de esquema y caducidad; una versión distinta o una entrada vencida (fuera de la ventana «obsoleto») se descarta.
//  · Límites: tamaño total y número de entradas, con desalojo LRU. Si IndexedDB no existe o falla, la caché se desactiva (nunca rompe la app).
export type CacheNamespace = 'public' | `u:${string}`

export type CacheEntry<T = unknown> = {
  id: string // `${ns}|${key}`
  ns: string
  key: string
  value: T
  version: string
  storedAt: number
  expiresAt: number
  touchedAt: number
  bytes: number
}

export type CacheHit<T> = { value: T; storedAt: number; fresh: boolean }

export type CacheOptions = {
  dbName?: string
  maxBytes?: number
  maxEntries?: number
  now?: () => number
  idb?: IDBFactory | null
}

const STORE = 'entries'
const DB_VERSION = 1
// Ventana en la que un dato vencido aún se muestra (sin conexión o mientras se revalida) antes de descartarse.
const STALE_WINDOW_MS = 7 * 24 * 3600 * 1000

export function privateNamespace(userId: string, tenantId?: string | null): CacheNamespace {
  return tenantId ? `u:${userId}:t:${tenantId}` : `u:${userId}`
}

function approximateBytes(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

const request = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error) })

export class OfflineCache {
  private readonly dbName: string
  private readonly maxBytes: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly factory: IDBFactory | null
  private dbPromise: Promise<IDBDatabase | null> | null = null
  private privateGen = 0

  constructor(options: CacheOptions = {}) {
    this.dbName = options.dbName ?? 'sportleagues-cache'
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024
    this.maxEntries = options.maxEntries ?? 400
    this.now = options.now ?? Date.now
    this.factory = options.idb === undefined ? (typeof indexedDB === 'undefined' ? null : indexedDB) : options.idb
  }

  get available(): boolean {
    return this.factory !== null
  }

  private open(): Promise<IDBDatabase | null> {
    if (!this.factory) return Promise.resolve(null)
    this.dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        const open = this.factory!.open(this.dbName, DB_VERSION)
        open.onupgradeneeded = () => {
          const store = open.result.createObjectStore(STORE, { keyPath: 'id' })
          store.createIndex('ns', 'ns')
          store.createIndex('touchedAt', 'touchedAt')
        }
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => resolve(null)
        open.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
    return this.dbPromise
  }

  private async run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T | null> {
    const db = await this.open()
    if (!db) return null
    try {
      const tx = db.transaction(STORE, mode)
      const result = await work(tx.objectStore(STORE))
      if (mode === 'readwrite') await done(tx)
      return result
    } catch {
      return null // cuota excedida, almacenamiento bloqueado, etc.: la caché es prescindible
    }
  }

  async get<T>(ns: CacheNamespace, key: string, version: string): Promise<CacheHit<T> | null> {
    const id = `${ns}|${key}`
    const entry = await this.run('readonly', (store) => request<CacheEntry<T> | undefined>(store.get(id)))
    if (!entry) return null
    const now = this.now()
    if (entry.version !== version || now > entry.expiresAt + STALE_WINDOW_MS) {
      void this.delete(ns, key)
      return null
    }
    void this.run('readwrite', async (store) => { store.put({ ...entry, touchedAt: now }) })
    return { value: entry.value, storedAt: entry.storedAt, fresh: now <= entry.expiresAt }
  }

  /**
   * Contador de purgas privadas (FE-10). Quien lee datos privados de la red lo captura ANTES de leer y lo pasa a `set`:
   * si entretanto hubo un cierre de sesión / cambio de usuario (`clearPrivate`), la escritura se descarta y no recrea
   * datos del usuario anterior.
   */
  get privateGeneration(): number {
    return this.privateGen
  }

  async set<T>(ns: CacheNamespace, key: string, value: T, options: { version: string; ttlMs: number; generation?: number }): Promise<boolean> {
    const bytes = approximateBytes(value)
    if (bytes > this.maxBytes / 2) return false // un único valor no puede acaparar la caché
    const now = this.now()
    const entry: CacheEntry<T> = { id: `${ns}|${key}`, ns, key, value, version: options.version, storedAt: now, expiresAt: now + options.ttlMs, touchedAt: now, bytes }
    const stale = (): boolean => ns !== 'public' && options.generation !== undefined && options.generation !== this.privateGen
    if (stale()) return false
    const stored = await this.run('readwrite', async (store) => { if (stale()) return false; store.put(entry); return true })
    if (!stored) return false
    await this.enforceLimits()
    return true
  }

  async delete(ns: CacheNamespace, key: string): Promise<void> {
    await this.run('readwrite', async (store) => { store.delete(`${ns}|${key}`) })
  }

  async clearNamespace(ns: string): Promise<void> {
    await this.run('readwrite', async (store) => {
      const keys = await request<IDBValidKey[]>(store.index('ns').getAllKeys(ns))
      for (const key of keys) store.delete(key)
    })
  }

  // Borra todo dato privado (cierre de sesión / cambio de usuario). Conserva únicamente el catálogo público.
  async clearPrivate(exceptUserId?: string): Promise<void> {
    this.privateGen += 1
    await this.run('readwrite', async (store) => {
      const all = await request<CacheEntry[]>(store.getAll())
      for (const entry of all) {
        if (entry.ns === 'public') continue
        if (exceptUserId && (entry.ns === `u:${exceptUserId}` || entry.ns.startsWith(`u:${exceptUserId}:`))) continue
        store.delete(entry.id)
      }
    })
  }

  async clearAll(): Promise<void> {
    await this.run('readwrite', async (store) => { store.clear() })
  }

  async purgeExpired(): Promise<number> {
    const now = this.now()
    return (await this.run('readwrite', async (store) => {
      const all = await request<CacheEntry[]>(store.getAll())
      let removed = 0
      for (const entry of all) if (now > entry.expiresAt + STALE_WINDOW_MS) { store.delete(entry.id); removed += 1 }
      return removed
    })) ?? 0
  }

  async stats(): Promise<{ entries: number; bytes: number }> {
    const all = (await this.run('readonly', (store) => request<CacheEntry[]>(store.getAll()))) ?? []
    return { entries: all.length, bytes: all.reduce((sum, entry) => sum + entry.bytes, 0) }
  }

  // Desalojo LRU hasta cumplir ambos límites.
  private async enforceLimits(): Promise<void> {
    await this.run('readwrite', async (store) => {
      const all = await request<CacheEntry[]>(store.getAll())
      let bytes = all.reduce((sum, entry) => sum + entry.bytes, 0)
      let count = all.length
      if (bytes <= this.maxBytes && count <= this.maxEntries) return
      for (const entry of all.sort((a, b) => a.touchedAt - b.touchedAt)) {
        if (bytes <= this.maxBytes && count <= this.maxEntries) break
        store.delete(entry.id)
        bytes -= entry.bytes
        count -= 1
      }
    })
  }
}

let shared: OfflineCache | null = null
export function getOfflineCache(): OfflineCache {
  shared ??= new OfflineCache()
  return shared
}
export function setOfflineCacheForTests(cache: OfflineCache | null): void {
  shared = cache
}

// Cierre de sesión / cambio de identidad: ningún dato privado sobrevive. No lanza nunca.
export async function purgePrivateCaches(keepUserId?: string): Promise<void> {
  try {
    await getOfflineCache().clearPrivate(keepUserId)
  } catch {
    /* la caché es prescindible */
  }
}
