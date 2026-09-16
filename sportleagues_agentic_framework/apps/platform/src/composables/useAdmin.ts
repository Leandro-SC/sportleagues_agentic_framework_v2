import { computed, ref } from 'vue'
import { canManageTenant, humanizeAdminRpcError, humanizeBrandingUploadError, type BrandingAssetKind, type PaymentStatus, type PoolStatus, type TenantRole } from '../lib/admin-contracts'
import { getSupabaseClient } from '../lib/supabase'

export type AdminTenant = { tenant_id: string; role: TenantRole; plan_code: 'free' | 'pro' }
export type AdminPool = { id: string; tenant_id: string; name: string; status: PoolStatus; lock_offset: string; requires_approval: boolean }
export type AdminParticipant = { id: string; profile_id: string; approval_status: 'pending' | 'approved'; payment_status: PaymentStatus; profiles: { display_name: string } | null }
export type PoolRule = { exact_points: number; outcome_points: number; tie_breaker: 'exact_predictions' | 'prediction_submitted_at' }
export type BrandingAssetPreview = { asset_id: string; asset_kind: BrandingAssetKind; signed_url: string }

function errorMessage(error: { message: string } | null): string | null {
  return error ? humanizeAdminRpcError(error.message) : null
}

export function useAdmin() {
  const tenants = ref<AdminTenant[]>([])
  const pools = ref<AdminPool[]>([])
  const participants = ref<AdminParticipant[]>([])
  const rule = ref<PoolRule | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const brandingSaving = ref(false)
  const brandingAssets = ref<Record<BrandingAssetKind, BrandingAssetPreview | null>>({ logo: null, banner: null })
  const error = ref('')
  const selectedTenantId = ref('')
  const selectedPoolId = ref('')
  const selectedTenant = computed(() => tenants.value.find((tenant) => tenant.tenant_id === selectedTenantId.value) ?? null)
  const selectedPool = computed(() => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null)
  const isAdmin = computed(() => canManageTenant(selectedTenant.value?.role))
  const activePools = computed(() => pools.value.filter((pool) => pool.status === 'open' || pool.status === 'paused').length)
  let brandingRefreshTimer: ReturnType<typeof setTimeout> | undefined

  async function load(profileId: string): Promise<void> {
    loading.value = true; error.value = ''
    const client = getSupabaseClient()
    const { data: memberships, error: membershipError } = await client.from('tenant_memberships').select('tenant_id, role').eq('profile_id', profileId).eq('is_active', true)
    if (membershipError) { error.value = 'No fue posible cargar la administración.'; loading.value = false; return }
    const adminMemberships = (memberships ?? []).filter((membership) => canManageTenant(membership.role as TenantRole))
    if (!adminMemberships.length) { tenants.value = []; pools.value = []; loading.value = false; return }
    const tenantIds = adminMemberships.map((membership) => membership.tenant_id)
    const { data: entitlements, error: entitlementError } = await client.from('tenant_entitlements').select('tenant_id, plan_code').in('tenant_id', tenantIds)
    if (entitlementError) { error.value = 'No fue posible cargar la administración.'; loading.value = false; return }
    tenants.value = adminMemberships.map((membership) => ({
      tenant_id: membership.tenant_id,
      role: membership.role as TenantRole,
      plan_code: (entitlements ?? []).find((entry) => entry.tenant_id === membership.tenant_id)?.plan_code as 'free' | 'pro' ?? 'free',
    }))
    selectedTenantId.value = selectedTenantId.value && tenants.value.some((tenant) => tenant.tenant_id === selectedTenantId.value) ? selectedTenantId.value : tenants.value[0].tenant_id
    await loadPools()
    await loadBrandingAssets()
    loading.value = false
  }

  async function loadPools(): Promise<void> {
    if (!selectedTenantId.value) return
    const { data, error: queryError } = await getSupabaseClient().from('pools').select('id, tenant_id, name, status, lock_offset, requires_approval').eq('tenant_id', selectedTenantId.value).order('created_at', { ascending: false })
    if (queryError) { error.value = 'No fue posible cargar las quinielas.'; return }
    pools.value = (data ?? []) as AdminPool[]
    selectedPoolId.value = selectedPoolId.value && pools.value.some((pool) => pool.id === selectedPoolId.value) ? selectedPoolId.value : (pools.value[0]?.id ?? '')
    if (selectedPoolId.value) await loadPoolDetails()
    else { participants.value = []; rule.value = null }
  }

  async function loadBrandingAssets(): Promise<void> {
    if (brandingRefreshTimer) clearTimeout(brandingRefreshTimer)
    brandingAssets.value = { logo: null, banner: null }
    if (!selectedTenant.value || selectedTenant.value.plan_code !== 'pro') return
    const client = getSupabaseClient()
    const { data, error: rpcError } = await client.rpc('get_active_branding_assets', { p_tenant_id: selectedTenant.value.tenant_id })
    if (rpcError) return
    const activeAssets = (data ?? []) as Array<{ asset_id: string; asset_kind: BrandingAssetKind; storage_path: string }>
    const previews = await Promise.all(activeAssets.map(async (asset) => {
      const { data: signed, error: signedError } = await client.storage.from('branding-assets').createSignedUrl(asset.storage_path, 60)
      return signedError || !signed?.signedUrl ? null : { asset_id: asset.asset_id, asset_kind: asset.asset_kind, signed_url: signed.signedUrl } satisfies BrandingAssetPreview
    }))
    const next: Record<BrandingAssetKind, BrandingAssetPreview | null> = { logo: null, banner: null }
    for (const preview of previews) if (preview) next[preview.asset_kind] = preview
    brandingAssets.value = next
    brandingRefreshTimer = setTimeout(() => { void loadBrandingAssets() }, 55_000)
  }

  async function brandingUploadError(error: unknown): Promise<string> {
    if (error && typeof error === 'object' && 'context' in error && (error as { context?: unknown }).context instanceof Response) {
      try {
        const payload = await (error as { context: Response }).context.json() as { code?: string }
        return humanizeBrandingUploadError(payload.code)
      } catch { /* Fall through to a safe generic message. */ }
    }
    return humanizeBrandingUploadError(null)
  }

  async function uploadBrandingAsset(kind: BrandingAssetKind, file: File): Promise<string | null> {
    if (!selectedTenant.value) return 'Selecciona un tenant administrable.'
    if (selectedTenant.value.plan_code !== 'pro') return humanizeBrandingUploadError('PLAN_REQUIRED')
    brandingSaving.value = true
    try {
      const client = getSupabaseClient()
      const { data: pending, error: beginError } = await client.rpc('begin_branding_asset', { p_tenant_id: selectedTenant.value.tenant_id, p_asset_kind: kind })
      if (beginError || !pending?.id) return errorMessage(beginError) ?? 'No pudimos iniciar la carga. Inténtalo nuevamente.'
      const body = new FormData()
      body.set('asset_id', pending.id)
      body.set('file', file)
      const { error: uploadError } = await client.functions.invoke('branding-asset', { body })
      if (uploadError) return await brandingUploadError(uploadError)
      await loadBrandingAssets()
      return null
    } catch {
      return humanizeBrandingUploadError(null)
    } finally {
      brandingSaving.value = false
    }
  }

  async function removeBrandingAsset(kind: BrandingAssetKind): Promise<string | null> {
    if (!selectedTenant.value) return 'Selecciona un tenant administrable.'
    brandingSaving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('remove_branding_asset', { p_tenant_id: selectedTenant.value.tenant_id, p_asset_kind: kind })
    brandingSaving.value = false
    const message = errorMessage(rpcError)
    if (!message) await loadBrandingAssets()
    return message
  }

  function dispose(): void {
    if (brandingRefreshTimer) clearTimeout(brandingRefreshTimer)
  }

  async function loadPoolDetails(): Promise<void> {
    if (!selectedPoolId.value) return
    const client = getSupabaseClient()
    const [{ data: participantData, error: participantError }, { data: ruleData, error: ruleError }] = await Promise.all([
      client.from('participants').select('id, profile_id, approval_status, payment_status, profiles(display_name)').eq('pool_id', selectedPoolId.value).order('created_at'),
      client.from('pool_rules').select('exact_points, outcome_points, tie_breaker').eq('pool_id', selectedPoolId.value).eq('is_current', true).maybeSingle(),
    ])
    if (participantError || ruleError) { error.value = 'No fue posible cargar la configuración.'; return }
    participants.value = (participantData ?? []) as unknown as AdminParticipant[]
    rule.value = ruleData as PoolRule | null
  }

  async function createPool(name: string, lockMinutes: number, requiresApproval: boolean): Promise<string | null> {
    if (!selectedTenant.value) return 'Selecciona un tenant administrable.'
    saving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('manage_pool', { p_action: 'create', p_pool_id: null, p_tenant_id: selectedTenant.value.tenant_id, p_name: name.trim(), p_lock_offset_minutes: lockMinutes, p_requires_approval: requiresApproval })
    saving.value = false
    const message = errorMessage(rpcError)
    if (!message) await loadPools()
    return message
  }

  async function updatePool(action: 'update' | 'open' | 'pause' | 'archive', name?: string, lockMinutes?: number, requiresApproval?: boolean): Promise<string | null> {
    if (!selectedPool.value) return 'Selecciona una quiniela.'
    saving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('manage_pool', { p_action: action, p_pool_id: selectedPool.value.id, p_tenant_id: null, p_name: name?.trim() ?? null, p_lock_offset_minutes: lockMinutes ?? null, p_requires_approval: requiresApproval ?? null })
    saving.value = false
    const message = errorMessage(rpcError)
    if (!message) await loadPools()
    return message
  }

  async function approveParticipant(participantId: string): Promise<string | null> {
    saving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('approve_participant', { p_participant_id: participantId })
    saving.value = false
    const message = errorMessage(rpcError)
    if (!message) await loadPoolDetails()
    return message
  }

  async function setPayment(participantId: string, status: PaymentStatus): Promise<string | null> {
    saving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('set_participant_payment_status', { p_participant_id: participantId, p_status: status })
    saving.value = false
    const message = errorMessage(rpcError)
    if (!message) await loadPoolDetails()
    return message
  }

  async function publishRules(exactPoints: number, outcomePoints: number, tieBreaker: PoolRule['tie_breaker']): Promise<string | null> {
    if (!selectedPool.value) return 'Selecciona una quiniela.'
    saving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('publish_pool_rules', { p_pool_id: selectedPool.value.id, p_exact_points: exactPoints, p_outcome_points: outcomePoints, p_tie_breaker: tieBreaker, p_bonus_rules: [] })
    saving.value = false
    const message = errorMessage(rpcError)
    if (!message) await loadPoolDetails()
    return message
  }

  async function createJoinCode(): Promise<{ code: string | null; error: string | null }> {
    if (!selectedPool.value) return { code: null, error: 'Selecciona una quiniela.' }
    saving.value = true
    const { data, error: rpcError } = await getSupabaseClient().rpc('create_pool_join_code', { p_pool_id: selectedPool.value.id, p_expires_at: null })
    saving.value = false
    return { code: data?.code ?? null, error: errorMessage(rpcError) }
  }

  async function saveBranding(primaryColor: string, secondaryColor: string): Promise<string | null> {
    if (!selectedTenant.value) return 'Selecciona un tenant administrable.'
    saving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('update_tenant_branding', { p_tenant_id: selectedTenant.value.tenant_id, p_primary_color: primaryColor || null, p_secondary_color: secondaryColor || null, p_logo_asset_id: null, p_banner_asset_id: null })
    saving.value = false
    return errorMessage(rpcError)
  }

  return { tenants, pools, participants, rule, loading, saving, brandingSaving, brandingAssets, error, selectedTenantId, selectedPoolId, selectedTenant, selectedPool, isAdmin, activePools, load, loadPools, loadBrandingAssets, loadPoolDetails, createPool, updatePool, approveParticipant, setPayment, publishRules, createJoinCode, saveBranding, uploadBrandingAsset, removeBrandingAsset, dispose }
}
