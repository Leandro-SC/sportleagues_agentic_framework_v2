import { computed, ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'

export type PlanCode = 'free' | 'pro'
export type PlanOffer = { offer_code: string; plan_code: PlanCode; scope: 'organization' | 'single_pool'; price_minor: number; currency: string; billing_period: 'month' | 'year' | 'one_time'; benefits: string[] }
export type RequestableTenant = { tenant_id: string; name: string }
export type RequestablePool = { id: string; tenant_id: string; name: string }

const FALLBACK_OFFERS: PlanOffer[] = [
  { offer_code: 'free', plan_code: 'free', scope: 'organization', price_minor: 0, currency: 'PEN', billing_period: 'month', benefits: ['1 quiniela activa', 'Máximo 10 participantes', 'Reglas estándar', 'Branding SportLeagues'] },
  { offer_code: 'pro_monthly', plan_code: 'pro', scope: 'organization', price_minor: 1990, currency: 'PEN', billing_period: 'month', benefits: ['Quinielas y participantes ampliados', 'Logo, banner y colores propios', 'Reglas configurables', 'Soporte prioritario'] },
  { offer_code: 'pro_annual', plan_code: 'pro', scope: 'organization', price_minor: 19900, currency: 'PEN', billing_period: 'year', benefits: ['Todos los beneficios PRO', 'Promoción anual: pagas 10 meses', 'Ahorro de S/ 39.80 frente al plan mensual'] },
  { offer_code: 'pro_single_pool', plan_code: 'pro', scope: 'single_pool', price_minor: 990, currency: 'PEN', billing_period: 'month', benefits: ['PRO para una sola quiniela', 'Logo y colores para esa quiniela', 'Ideal para un torneo puntual'] },
]

function parseOffer(row: Record<string, unknown>): PlanOffer | null {
  if ((row.plan_code !== 'free' && row.plan_code !== 'pro') || typeof row.offer_code !== 'string' || typeof row.price_minor !== 'number' || typeof row.currency !== 'string') return null
  if (row.billing_period !== 'month' && row.billing_period !== 'year' && row.billing_period !== 'one_time') return null
  if (row.scope !== 'organization' && row.scope !== 'single_pool') return null
  return { offer_code: row.offer_code, plan_code: row.plan_code, scope: row.scope, price_minor: row.price_minor, currency: row.currency, billing_period: row.billing_period, benefits: Array.isArray(row.benefits) ? row.benefits.filter((v): v is string => typeof v === 'string') : [] }
}

export function formatPlanPrice(plan: PlanOffer): string {
  if (plan.price_minor === 0) return 'Gratis'
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: plan.currency, minimumFractionDigits: 2 }).format(plan.price_minor / 100) + (plan.billing_period === 'month' ? '/mes' : plan.billing_period === 'year' ? '/año' : '')
}

export function usePlanCatalog() {
  const offers = ref<PlanOffer[]>(FALLBACK_OFFERS)
  const tenants = ref<RequestableTenant[]>([])
  const pools = ref<RequestablePool[]>([])
  const loading = ref(false)
  const requesting = ref(false)
  const error = ref('')
  const notice = ref('')
  const canRequestPro = computed(() => tenants.value.length > 0)

  async function load(userId?: string): Promise<void> {
    loading.value = true; error.value = ''
    const client = getSupabaseClient()
    const { data, error: offerError } = await client.from('plan_offers').select('offer_code, plan_code, scope, price_minor, currency, billing_period, benefits').eq('is_public', true).order('price_minor')
    if (!offerError) {
      const parsed = (data ?? []).map((row) => parseOffer(row as Record<string, unknown>)).filter((row): row is PlanOffer => row !== null)
      if (parsed.length) offers.value = parsed
    }
    if (userId) {
      const { data: memberships, error: membershipError } = await client.from('tenant_memberships').select('tenant_id, tenants(name)').eq('profile_id', userId).eq('is_active', true).in('role', ['owner', 'admin'])
      if (!membershipError) tenants.value = (memberships ?? []).flatMap((row: any) => typeof row.tenant_id === 'string' ? [{ tenant_id: row.tenant_id, name: typeof row.tenants?.name === 'string' ? row.tenants.name : `Organización ${row.tenant_id.slice(0, 8)}` }] : [])
      if (tenants.value.length) {
        const { data: poolRows } = await client.from('pools').select('id, tenant_id, name').in('tenant_id', tenants.value.map((tenant) => tenant.tenant_id))
        pools.value = (poolRows ?? []).flatMap((row: any) => typeof row.id === 'string' && typeof row.tenant_id === 'string' && typeof row.name === 'string' ? [{ id: row.id, tenant_id: row.tenant_id, name: row.name }] : [])
      }
    }
    loading.value = false
  }

  async function requestPro(tenantId: string, offer: PlanOffer, poolId: string | null = null): Promise<boolean> {
    if (!tenants.value.some((tenant) => tenant.tenant_id === tenantId)) return false
    if (offer.scope === 'single_pool' && (!poolId || !pools.value.some((pool) => pool.id === poolId && pool.tenant_id === tenantId))) { error.value = 'Selecciona una quiniela para el plan PRO individual.'; return false }
    requesting.value = true; error.value = ''; notice.value = ''
    const { error: rpcError } = await getSupabaseClient().rpc('request_plan_change', { p_tenant_id: tenantId, p_offer_code: offer.offer_code, p_pool_id: poolId })
    requesting.value = false
    if (rpcError) { error.value = /legal acceptance required/.test(rpcError.message) ? 'Acepta los documentos legales antes de solicitar un plan.' : 'No pudimos enviar tu solicitud. Inténtalo nuevamente.'; return false }
    notice.value = 'Solicitud PRO enviada. Un operador la revisará; no se realizó ningún cobro.'
    return true
  }

  return { offers, tenants, pools, loading, requesting, error, notice, canRequestPro, load, requestPro }
}
