import { ref } from 'vue'
import { safeAccent } from '../lib/branding'
import { getSupabaseClient } from '../lib/supabase'

/**
 * Marca del organizador de una quiniela, tal como la ven sus jugadores: nombre de plataforma (todos los planes), y logo, banner y
 * color (PRO). `joinCode` solo llega a quien puede leer los códigos de unión (administradores, por RLS R5); para el resto es null.
 * Cualquier fallo deja la marca de SportLeagues: nunca bloquea la quiniela.
 */
export type TenantBranding = {
  tenantId: string
  plan: 'free' | 'pro'
  brandName: string | null
  accent: string | null
  logoUrl: string | null
  bannerUrl: string | null
  joinCode: string | null
}

type Client = ReturnType<typeof getSupabaseClient>
type Row = Record<string, unknown>

// Las URL firmadas viven lo suficiente para mostrar la vista y generar flyers; no se arma polling.
const SIGNED_URL_SECONDS = 600

export function useTenantBranding(clientFactory: () => Client = getSupabaseClient) {
  const branding = ref<TenantBranding | null>(null)
  const loading = ref(false)
  let generation = 0

  async function load(poolId: string): Promise<void> {
    const current = ++generation
    loading.value = true
    try {
      const client = clientFactory()
      const { data: pool } = await client.from('pools').select('tenant_id').eq('id', poolId).maybeSingle()
      const tenantId = (pool as Row | null)?.tenant_id as string | undefined
      if (!tenantId) { if (current === generation) branding.value = null; return }
      const [plan, brand, code] = await Promise.all([
        client.from('tenant_entitlements').select('plan_code').eq('tenant_id', tenantId).maybeSingle(),
        client.from('tenant_branding').select('brand_name, primary_color').eq('tenant_id', tenantId).maybeSingle(),
        client.from('pool_join_codes').select('code').eq('pool_id', poolId).eq('is_enabled', true)
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`).order('created_at', { ascending: false }).limit(1),
      ])
      const isPro = (plan.data as Row | null)?.plan_code === 'pro'
      const brandRow = (brand.data as Row | null) ?? {}
      let logoUrl: string | null = null
      let bannerUrl: string | null = null
      if (isPro) {
        const { data: assets } = await client.rpc('get_active_branding_assets', { p_tenant_id: tenantId })
        const signed = await Promise.all(((assets ?? []) as Row[]).map(async (asset) => {
          const { data } = await client.storage.from('branding-assets').createSignedUrl(asset.storage_path as string, SIGNED_URL_SECONDS)
          return { kind: asset.asset_kind as string, url: data?.signedUrl ?? null }
        }))
        logoUrl = signed.find((item) => item.kind === 'logo')?.url ?? null
        bannerUrl = signed.find((item) => item.kind === 'banner')?.url ?? null
      }
      if (current !== generation) return
      branding.value = {
        tenantId,
        plan: isPro ? 'pro' : 'free',
        brandName: (brandRow.brand_name as string | null | undefined)?.trim() || null,
        accent: isPro ? safeAccent(brandRow.primary_color as string | null | undefined) : null,
        logoUrl, bannerUrl,
        joinCode: (((code.data ?? []) as Row[])[0]?.code as string | undefined) ?? null,
      }
    } catch {
      if (current === generation) branding.value = null
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reset(): void { generation++; branding.value = null; loading.value = false }

  return { branding, loading, load, reset }
}
