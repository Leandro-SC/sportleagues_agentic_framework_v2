import { ref } from 'vue'
import { resolvePoolAccess, type PoolSummary } from '../lib/pool-access'
import { getSupabaseClient } from '../lib/supabase'
import { getOfflineCache, privateNamespace } from '../lib/offline-cache'

type PoolQueryResult = { data: PoolSummary | null; error: { message: string } | null }

export type PoolAccessClient = {
  from: (table: 'pools') => {
    select: (columns: 'id, name') => {
      eq: (column: 'id', value: string) => {
        maybeSingle: () => Promise<PoolQueryResult>
      }
    }
  }
}

type PoolAccessClientFactory = () => PoolAccessClient
const ACCESS_CACHE_VERSION = 'pool-access-v1'
type AccessSnapshot = { pool: PoolSummary | null; denied: boolean }

const defaultClientFactory: PoolAccessClientFactory = () => getSupabaseClient() as unknown as PoolAccessClient

export function usePoolAccess(clientFactory: PoolAccessClientFactory = defaultClientFactory) {
  const pool = ref<PoolSummary | null>(null)
  const denied = ref(false)
  const error = ref('')
  const loading = ref(true)
  const offline = ref(false)

  async function load(poolId: string, profileId?: string | null): Promise<void> {
    loading.value = true; denied.value = false; error.value = ''; offline.value = false; pool.value = null
    if (!poolId) {
      error.value = 'La quiniela solicitada no es válida.'
      loading.value = false
      return
    }

    const cache = getOfflineCache()
    const ns = profileId ? privateNamespace(profileId) : null
    const key = `access:${poolId}`
    let cached = false
    if (ns) {
      const hit = await cache.get<AccessSnapshot>(ns, key, ACCESS_CACHE_VERSION)
      if (hit) {
        pool.value = hit.value.pool
        denied.value = hit.value.denied
        cached = true
      }
    }

    try {
      const { data, error: queryError } = await clientFactory().from('pools').select('id, name').eq('id', poolId).maybeSingle()
      if (queryError) {
        if (cached) offline.value = true
        else error.value = queryError.message
        return
      }

      const result = resolvePoolAccess(data)
      pool.value = result.pool
      denied.value = result.denied
      if (ns) void cache.set(ns, key, result, { version: ACCESS_CACHE_VERSION, ttlMs: 24 * 3600_000, generation: cache.privateGeneration })
    } catch {
      if (cached) offline.value = true
      else error.value = 'No fue posible verificar el acceso a la quiniela.'
    } finally {
      loading.value = false
    }
  }

  return { pool, denied, error, loading, offline, load }
}
