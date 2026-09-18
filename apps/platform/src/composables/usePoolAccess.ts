import { ref } from 'vue'
import { resolvePoolAccess, type PoolSummary } from '../lib/pool-access'
import { getSupabaseClient } from '../lib/supabase'

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

const defaultClientFactory: PoolAccessClientFactory = () => getSupabaseClient() as unknown as PoolAccessClient

export function usePoolAccess(clientFactory: PoolAccessClientFactory = defaultClientFactory) {
  const pool = ref<PoolSummary | null>(null)
  const denied = ref(false)
  const error = ref('')
  const loading = ref(true)

  async function load(poolId: string): Promise<void> {
    loading.value = true; denied.value = false; error.value = ''; pool.value = null
    if (!poolId) {
      error.value = 'La quiniela solicitada no es válida.'
      loading.value = false
      return
    }

    try {
      const { data, error: queryError } = await clientFactory().from('pools').select('id, name').eq('id', poolId).maybeSingle()
      if (queryError) {
        error.value = queryError.message
        return
      }

      const result = resolvePoolAccess(data)
      pool.value = result.pool
      denied.value = result.denied
    } catch {
      error.value = 'No fue posible verificar el acceso a la quiniela.'
    } finally {
      loading.value = false
    }
  }

  return { pool, denied, error, loading, load }
}
