import { ref } from 'vue'
import { canManageTenant, type TenantRole } from '../lib/admin-contracts'
import { getSupabaseClient } from '../lib/supabase'

type MembershipRow = { role: TenantRole }
type MembershipsResult = { data: MembershipRow[] | null; error: { message: string } | null }

// Answers exactly one question — "does this user administer at least one active tenant?" —
// for the `/admin` router guard. This is deliberately not `useAdmin.load()`: that composable
// fetches full panel data (tenants, pools, participants, branding) for a specific profile and is
// meant to run once the route already mounted. Both share the same authority for "what counts as
// admin" (`canManageTenant`), so there is only one implementation of that rule, just two
// different amounts of data fetched for two different purposes (route guard vs. panel data).
export type TenantAdminAccessClient = {
  from: (table: 'tenant_memberships') => {
    select: (columns: 'role') => {
      eq: (column: 'profile_id', value: string) => {
        eq: (column: 'is_active', value: boolean) => Promise<MembershipsResult>
      }
    }
  }
}

type TenantAdminAccessClientFactory = () => TenantAdminAccessClient

const defaultClientFactory: TenantAdminAccessClientFactory = () => getSupabaseClient() as unknown as TenantAdminAccessClient

export function useTenantAdminAccess(clientFactory: TenantAdminAccessClientFactory = defaultClientFactory) {
  const hasTenantAdminAccess = ref(false)
  const loading = ref(true)
  const error = ref('')

  async function checkAccess(profileId: string): Promise<boolean> {
    loading.value = true
    error.value = ''
    try {
      const { data, error: queryError } = await clientFactory()
        .from('tenant_memberships')
        .select('role')
        .eq('profile_id', profileId)
        .eq('is_active', true)
      if (queryError) {
        error.value = 'No fue posible verificar el acceso administrativo.'
        hasTenantAdminAccess.value = false
        return false
      }
      hasTenantAdminAccess.value = (data ?? []).some((membership) => canManageTenant(membership.role))
      return hasTenantAdminAccess.value
    } catch {
      error.value = 'No fue posible verificar el acceso administrativo.'
      hasTenantAdminAccess.value = false
      return false
    } finally {
      loading.value = false
    }
  }

  return { hasTenantAdminAccess, loading, error, checkAccess }
}
