import { computed, ref } from 'vue'
import { canManageTenant, humanizeAdminRpcError, humanizeBrandingUploadError, type BrandingAssetKind, type PaymentStatus, type PoolStatus, type TenantRole } from '../lib/admin-contracts'
import { getSupabaseClient } from '../lib/supabase'

export type AdminTenant = { tenant_id: string; role: TenantRole; plan_code: 'free' | 'pro' }
export type AdminPool = { id: string; tenant_id: string; name: string; status: PoolStatus; lock_offset: string; requires_approval: boolean; ticketing_mode: 'none' | 'tickets' }
export type AdminParticipant = { id: string; profile_id: string; approval_status: 'pending' | 'approved'; payment_status: PaymentStatus; profiles: { display_name: string } | null }
export type PoolRule = { exact_points: number; outcome_points: number; tie_breaker: 'exact_predictions' | 'prediction_submitted_at' }
/** ADR-023. `null` si el servidor aún no expone `pool_rules_policy`: la UI no bloquea y el servidor sigue siendo la autoridad. */
export type PoolRulesPolicy = { editable: boolean; customAllowed: boolean }
export type BrandingColors = { primary: string | null; secondary: string | null }
export type BrandingAssetPreview= { asset_id: string; asset_kind: BrandingAssetKind; signed_url: string }

// Las URL firmadas duran 60 s; se renuevan un poco antes de vencer.
const BRANDING_REFRESH_MS = 55_000
export const BRANDING_COLORS_UNAVAILABLE = 'No pudimos cargar los colores actuales de tu organización. Recarga la página antes de guardar para no sobrescribirlos.'

function errorMessage(error: { message: string } | null): string | null {
  return error ? humanizeAdminRpcError(error.message) : null
}

/**
 * `branding: false` para las vistas que solo necesitan organizaciones y quinielas (panel y parrilla):
 * no leen colores ni firman URLs de imágenes de marca, y por tanto no arman ningún polling.
 */
export function useAdmin(options: { branding?: boolean } = {}) {
  const resolved = { branding: options.branding ?? true }
  const tenants = ref<AdminTenant[]>([])
  const pools = ref<AdminPool[]>([])
  const participants = ref<AdminParticipant[]>([])
  const rule = ref<PoolRule | null>(null)
  const rulesPolicy = ref<PoolRulesPolicy | null>(null)
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
  // Colores guardados del tenant (FE-02): el formulario parte de ellos, nunca de valores de ejemplo.
  const brandingColors = ref<BrandingColors | null>(null)
  const brandName = ref<string | null>(null)
  const brandingColorsStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  let brandingRefreshTimer: ReturnType<typeof setTimeout> | undefined
  // `dispose` es terminal: tras desmontar la vista ninguna carga en vuelo vuelve a armar el temporizador (FE-03).
  let disposed = false
  let brandingGeneration = 0
  let colorsGeneration = 0
  let loadGeneration = 0
  let epoch = 0 // se incrementa en reset(): descarta lecturas de la identidad anterior

  function stopBrandingPolling(): void {
    if (brandingRefreshTimer) clearTimeout(brandingRefreshTimer)
    brandingRefreshTimer = undefined
  }

  async function load(profileId: string): Promise<void> {
    const generation = ++loadGeneration
    loading.value = true; error.value = ''
    const client = getSupabaseClient()
    const { data: memberships, error: membershipError } = await client.from('tenant_memberships').select('tenant_id, role').eq('profile_id', profileId).eq('is_active', true)
    if (generation !== loadGeneration) return
    if (membershipError) { error.value = 'No fue posible cargar la administración.'; loading.value = false; return }
    const adminMemberships = (memberships ?? []).filter((membership) => canManageTenant(membership.role as TenantRole))
    if (!adminMemberships.length) { tenants.value = []; pools.value = []; loading.value = false; return }
    const tenantIds = adminMemberships.map((membership) => membership.tenant_id)
    const { data: entitlements, error: entitlementError } = await client.from('tenant_entitlements').select('tenant_id, plan_code').in('tenant_id', tenantIds)
    if (generation !== loadGeneration) return
    if (entitlementError) { error.value = 'No fue posible cargar la administración.'; loading.value = false; return }
    tenants.value = adminMemberships.map((membership) => ({
      tenant_id: membership.tenant_id,
      role: membership.role as TenantRole,
      plan_code: (entitlements ?? []).find((entry) => entry.tenant_id === membership.tenant_id)?.plan_code as 'free' | 'pro' ?? 'free',
    }))
    selectedTenantId.value = selectedTenantId.value && tenants.value.some((tenant) => tenant.tenant_id === selectedTenantId.value) ? selectedTenantId.value : tenants.value[0].tenant_id
    await Promise.all([loadPools(), ...(resolved.branding ?[loadBrandingAssets(), loadBrandingColors()] : [])])
    if (generation === loadGeneration) loading.value = false
  }

  /** Vuelve al estado inicial y detiene el polling (cambio de identidad, FE-05). */
  function reset(): void {
    stopBrandingPolling()
    brandingGeneration++; colorsGeneration++; loadGeneration++; epoch++
    tenants.value = []; pools.value = []; participants.value = []; rule.value = null; rulesPolicy.value = null
    brandingAssets.value = { logo: null, banner: null }
    brandingColors.value = null; brandName.value = null; brandingColorsStatus.value = 'idle'
    selectedTenantId.value = ''; selectedPoolId.value = ''
    error.value = ''; loading.value = false; saving.value = false; brandingSaving.value = false
  }

  async function loadBrandingColors(): Promise<void> {
    const generation = ++colorsGeneration
    brandingColors.value = null
    const tenantId = selectedTenantId.value
    if (!tenantId) { brandingColorsStatus.value = 'idle'; return }
    brandingColorsStatus.value = 'loading'
    try {
      const { data, error: queryError } = await getSupabaseClient().from('tenant_branding').select('primary_color, secondary_color, brand_name').eq('tenant_id', tenantId).maybeSingle()
      if (disposed || generation !== colorsGeneration) return
      if (queryError) { brandingColorsStatus.value = 'error'; return }
      brandingColors.value = { primary: (data?.primary_color as string | null | undefined) ?? null, secondary: (data?.secondary_color as string | null | undefined) ?? null }
      brandName.value = (data?.brand_name as string | null | undefined) ?? null
      brandingColorsStatus.value = 'ready'
    } catch {
      if (generation === colorsGeneration) brandingColorsStatus.value = 'error'
    }
  }

  async function loadPools(): Promise<void> {
    if (!selectedTenantId.value) return
    const startEpoch = epoch
    const { data, error: queryError } = await getSupabaseClient().from('pools').select('id, tenant_id, name, status, lock_offset, requires_approval, ticketing_mode').eq('tenant_id', selectedTenantId.value).order('created_at', { ascending: false })
    if (startEpoch !== epoch) return
    if (queryError) { error.value = 'No fue posible cargar las quinielas.'; return }
    pools.value = (data ?? []) as AdminPool[]
    selectedPoolId.value = selectedPoolId.value && pools.value.some((pool) => pool.id === selectedPoolId.value) ? selectedPoolId.value : (pools.value[0]?.id ?? '')
    if (selectedPoolId.value) await loadPoolDetails()
    else { participants.value = []; rule.value = null; rulesPolicy.value = null }
  }

  async function loadBrandingAssets(): Promise<void> {
    stopBrandingPolling()
    const generation = ++brandingGeneration
    brandingAssets.value = { logo: null, banner: null }
    // Sin PRO no hay imágenes de marca: no se consulta ni se arma el polling (FE-03).
    if (disposed || !selectedTenant.value || selectedTenant.value.plan_code !== 'pro') return
    const client = getSupabaseClient()
    const { data, error: rpcError } = await client.rpc('get_active_branding_assets', { p_tenant_id: selectedTenant.value.tenant_id })
    if (disposed || generation !== brandingGeneration || rpcError) return
    const activeAssets = (data ?? []) as Array<{ asset_id: string; asset_kind: BrandingAssetKind; storage_path: string }>
    const previews = await Promise.all(activeAssets.map(async (asset) => {
      const { data: signed, error: signedError } = await client.storage.from('branding-assets').createSignedUrl(asset.storage_path, 60)
      return signedError || !signed?.signedUrl ? null : { asset_id: asset.asset_id, asset_kind: asset.asset_kind, signed_url: signed.signedUrl } satisfies BrandingAssetPreview
    }))
    if (disposed || generation !== brandingGeneration) return
    const next: Record<BrandingAssetKind, BrandingAssetPreview | null> = { logo: null, banner: null }
    for (const preview of previews) if (preview) next[preview.asset_kind] = preview
    brandingAssets.value = next
    brandingRefreshTimer = setTimeout(() => { void loadBrandingAssets() }, BRANDING_REFRESH_MS)
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

  /** Terminal: detiene el polling y descarta cualquier carga en vuelo (FE-03). Llamar al desmontar la vista. */
  function dispose(): void {
    disposed = true
    brandingGeneration++; colorsGeneration++
    stopBrandingPolling()
  }

  async function loadPoolDetails(): Promise<void> {
    if (!selectedPoolId.value) return
    const client = getSupabaseClient()
    const startEpoch = epoch
    const [{ data: participantData, error: participantError }, { data: ruleData, error: ruleError }, { data: policyData, error: policyError }] = await Promise.all([
      // UAT-01: `participants` no tiene FK directa a `profiles`; la RPC autoriza por quiniela y expone solo el nombre visible.
      client.rpc('admin_pool_participants', { p_pool_id: selectedPoolId.value }),
      client.from('pool_rules').select('exact_points, outcome_points, tie_breaker').eq('pool_id', selectedPoolId.value).eq('is_current', true).maybeSingle(),
      client.rpc('pool_rules_policy', { p_pool_id: selectedPoolId.value }),
    ])
    if (startEpoch !== epoch) return
    if (participantError || ruleError) { error.value = 'No fue posible cargar la configuración.'; return }
    participants.value = ((participantData ?? []) as Array<{ id: string; profile_id: string; approval_status: 'pending' | 'approved'; payment_status: PaymentStatus; display_name: string | null }>).map((participant) => ({
      id: participant.id, profile_id: participant.profile_id, approval_status: participant.approval_status, payment_status: participant.payment_status,
      profiles: participant.display_name ? { display_name: participant.display_name } : null,
    }))
    rule.value = ruleData as PoolRule | null
    const policy = (Array.isArray(policyData) ? policyData[0] : policyData) as { editable: boolean; custom_allowed: boolean } | null | undefined
    rulesPolicy.value = !policyError && policy ? { editable: policy.editable, customAllowed: policy.custom_allowed } : null
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

  /**
   * Guarda los colores; `''` significa «sin color» (null). Solo se permite con los colores actuales ya
   * leídos del tenant: sin ellos no se sabe qué se está sobrescribiendo (FE-02).
   */
  async function saveBranding(primaryColor: string, secondaryColor: string): Promise<string | null> {
    if (!selectedTenant.value) return 'Selecciona un tenant administrable.'
    if (brandingColorsStatus.value !== 'ready') return BRANDING_COLORS_UNAVAILABLE
    const primary = primaryColor.trim() || null
    const secondary = secondaryColor.trim() || null
    saving.value = true
    const { error: rpcError } = await getSupabaseClient().rpc('update_tenant_branding', { p_tenant_id: selectedTenant.value.tenant_id, p_primary_color: primary, p_secondary_color: secondary, p_logo_asset_id: null, p_banner_asset_id: null })
    saving.value = false
    const message = errorMessage(rpcError)
    if (!message) brandingColors.value = { primary, secondary }
    return message
  }

  /** Nombre de la plataforma del organizador (ADR-024): todos los planes; vacío lo quita. */
  async function saveBrandName(name: string): Promise<string | null> {
    if (!selectedTenant.value) return 'Selecciona un tenant administrable.'
    saving.value = true
    const { data, error: rpcError } = await getSupabaseClient().rpc('set_tenant_brand_name', { p_tenant_id: selectedTenant.value.tenant_id, p_brand_name: name })
    saving.value = false
    const message = errorMessage(rpcError)
    if (!message) brandName.value = ((data as { brand_name?: string | null } | null)?.brand_name) ?? null
    return message
  }

  return { tenants, pools, participants, rule, rulesPolicy, brandName, saveBrandName, loading, saving, brandingSaving, brandingAssets, error, selectedTenantId, selectedPoolId, selectedTenant, selectedPool, isAdmin, activePools, load, loadPools, loadBrandingAssets, loadBrandingColors, brandingColors, brandingColorsStatus, reset, loadPoolDetails, createPool, updatePool, approveParticipant, setPayment, publishRules, createJoinCode, saveBranding, uploadBrandingAsset, removeBrandingAsset, dispose }
}
