import { ref } from 'vue'
import type { PoolStatus } from '../lib/admin-contracts'
import { getSupabaseClient } from '../lib/supabase'

// Ligas (quinielas) en las que participa el usuario. Datos reales bajo RLS: `participants` y
// `pools` solo devuelven filas de tenants donde el usuario tiene membresía activa. Se filtra por el
// profile_id de la sesión solo para acotar el resultado; la autorización la decide la base.
export type MyPool = { id: string; name: string; status: PoolStatus; approval_status: 'pending' | 'approved' }

type ParticipantRow = { pool_id: string; approval_status: 'pending' | 'approved' }
type PoolRow = { id: string; name: string; status: PoolStatus }
type QueryError = { message: string } | null

export type MyPoolsClient = {
  from(table: 'participants'): {
    select(columns: 'pool_id, approval_status'): {
      eq(column: 'profile_id', value: string): Promise<{ data: ParticipantRow[] | null; error: QueryError }>
    }
  }
  from(table: 'pools'): {
    select(columns: 'id, name, status'): {
      in(column: 'id', values: string[]): Promise<{ data: PoolRow[] | null; error: QueryError }>
    }
  }
}

const defaultClientFactory = () => getSupabaseClient() as unknown as MyPoolsClient

export function useMyPools(clientFactory: () => MyPoolsClient = defaultClientFactory) {
  const pools = ref<MyPool[]>([])
  const loading = ref(false)
  const error = ref('')

  async function load(profileId: string | null | undefined): Promise<void> {
    pools.value = []
    error.value = ''
    if (!profileId) return
    loading.value = true
    try {
      const client = clientFactory()
      const { data: participants, error: participantsError } = await client.from('participants').select('pool_id, approval_status').eq('profile_id', profileId)
      if (participantsError) throw new Error(participantsError.message)
      const ids = [...new Set((participants ?? []).map((participant) => participant.pool_id))]
      if (!ids.length) return
      const { data: rows, error: poolsError } = await client.from('pools').select('id, name, status').in('id', ids)
      if (poolsError) throw new Error(poolsError.message)
      const approval = new Map((participants ?? []).map((participant) => [participant.pool_id, participant.approval_status]))
      pools.value = (rows ?? [])
        .map((pool) => ({ ...pool, approval_status: approval.get(pool.id) ?? 'pending' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      error.value = 'No pudimos cargar tus ligas. Inténtalo de nuevo.'
    } finally {
      loading.value = false
    }
  }

  return { pools, loading, error, load }
}
