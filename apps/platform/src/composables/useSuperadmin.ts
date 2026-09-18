import { ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'

type IsPlatformAdminResult = { data: boolean | null; error: { message: string } | null }

// Deliberately narrow: the only call this composable can make is the zero-argument
// `is_platform_admin()` RPC. There is no way to pass a user id, so the caller can never ask
// about anyone's access but its own current session.
export type SuperadminClient = {
  rpc: (fn: 'is_platform_admin') => Promise<IsPlatformAdminResult>
}

type SuperadminClientFactory = () => SuperadminClient

const defaultClientFactory: SuperadminClientFactory = () => getSupabaseClient() as unknown as SuperadminClient

export function useSuperadmin(clientFactory: SuperadminClientFactory = defaultClientFactory) {
  const isPlatformAdmin = ref(false)
  const loading = ref(true)
  const error = ref('')

  async function checkAccess(): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: rpcError } = await clientFactory().rpc('is_platform_admin')
      if (rpcError) {
        error.value = 'No fue posible verificar el acceso.'
        isPlatformAdmin.value = false
        return false
      }
      isPlatformAdmin.value = data === true
      return isPlatformAdmin.value
    } catch {
      error.value = 'No fue posible verificar el acceso.'
      isPlatformAdmin.value = false
      return false
    } finally {
      loading.value = false
    }
  }

  return { isPlatformAdmin, loading, error, checkAccess }
}
