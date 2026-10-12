import { computed, ref } from 'vue'
import { canManageTenant, type PaymentStatus, type PoolStatus, type TenantRole } from '../lib/admin-contracts'
import { summarizeParticipation, type FinanceParticipant, type FinancePool } from '../lib/admin-finance'
import { getSupabaseClient } from '../lib/supabase'

// «Mis finanzas» (solo lectura). Toda lectura pasa por RLS: lo que el servidor no autoriza no llega.
// Este composable NO deriva nada de la URL ni del estado de la vista: la lista de organizaciones se
// construye únicamente con las membresías admin ACTIVAS del usuario autenticado, y
// `selectTenant` ignora cualquier id que no esté en esa lista (un id ajeno nunca dispara consultas).
export type FinanceTenant = { tenant_id: string; role: TenantRole; name: string | null }

export type FinanceResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null }
export interface FinanceQuery extends PromiseLike<FinanceResult> {
  eq(column: string, value: string | boolean): FinanceQuery
  in(column: string, values: string[]): FinanceQuery
  order(column: string, options?: { ascending?: boolean }): FinanceQuery
  range(from: number, to: number): FinanceQuery
}
export type AdminFinanceClient = {
  from: (table: 'tenant_memberships' | 'tenants' | 'pools' | 'participants') => { select: (columns: string) => FinanceQuery }
}
type AdminFinanceClientFactory = () => AdminFinanceClient

const defaultClientFactory: AdminFinanceClientFactory = () => getSupabaseClient() as unknown as AdminFinanceClient

// PostgREST limita las respuestas (1000 filas por defecto): se pagina y, si se llegara al tope de
// seguridad, se avisa en vez de mostrar conteos silenciosamente incompletos.
export const PARTICIPANT_PAGE_SIZE = 1000
export const PARTICIPANT_MAX_PAGES = 20

const LOAD_ERROR = 'No fue posible cargar tus finanzas. Revisa tu conexión e inténtalo de nuevo.'
const POOLS_ERROR = 'No fue posible cargar las quinielas de esta organización.'
const PAYMENT_STATUSES: PaymentStatus[] = ['paid', 'pending', 'invited']
const POOL_STATUSES: PoolStatus[] = ['draft', 'open', 'paused', 'archived']

function toPool(row: Record<string, unknown>): FinancePool | null {
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return null
  const status = POOL_STATUSES.includes(row.status as PoolStatus) ? (row.status as PoolStatus) : 'draft'
  return { id: row.id, name: row.name, status }
}

function toParticipant(row: Record<string, unknown>): FinanceParticipant | null {
  if (typeof row.pool_id !== 'string') return null
  if (!PAYMENT_STATUSES.includes(row.payment_status as PaymentStatus)) return null
  if (row.approval_status !== 'pending' && row.approval_status !== 'approved') return null
  return { pool_id: row.pool_id, approval_status: row.approval_status, payment_status: row.payment_status as PaymentStatus, withdrawn_at: typeof row.withdrawn_at === 'string' ? row.withdrawn_at : null }
}

export function useAdminFinance(clientFactory: AdminFinanceClientFactory = defaultClientFactory) {
  const tenants = ref<FinanceTenant[]>([])
  const selectedTenantId = ref('')
  const pools = ref<FinancePool[]>([])
  const participants = ref<FinanceParticipant[]>([])
  const loading = ref(false)
  const loadingTenant = ref(false)
  const error = ref('')
  const truncated = ref(false)
  let generation = 0

  const selectedTenant = computed(() => tenants.value.find((tenant) => tenant.tenant_id === selectedTenantId.value) ?? null)
  const summary = computed(() => summarizeParticipation(pools.value, participants.value))

  function reset(): void {
    tenants.value = []; selectedTenantId.value = ''; pools.value = []; participants.value = []; truncated.value = false
  }

  async function load(profileId: string): Promise<void> {
    const mine = ++generation
    loading.value = true; error.value = ''; reset()
    try {
      const client = clientFactory()
      const { data: memberships, error: membershipError } = await client.from('tenant_memberships').select('tenant_id, role').eq('profile_id', profileId).eq('is_active', true)
      if (mine !== generation) return
      if (membershipError) { error.value = LOAD_ERROR; return }
      const adminMemberships = (memberships ?? []).filter((row) => typeof row.tenant_id === 'string' && canManageTenant(row.role as TenantRole))
      if (!adminMemberships.length) return
      const ids = adminMemberships.map((row) => row.tenant_id as string)
      // Los nombres son solo cosméticos: si fallan, se cae a un identificador corto sin bloquear la vista.
      const { data: names } = await client.from('tenants').select('id, name').in('id', ids)
      if (mine !== generation) return
      const nameById = new Map((names ?? []).filter((row) => typeof row.id === 'string' && typeof row.name === 'string').map((row) => [row.id as string, row.name as string]))
      tenants.value = adminMemberships.map((row) => ({ tenant_id: row.tenant_id as string, role: row.role as TenantRole, name: nameById.get(row.tenant_id as string) ?? null }))
      selectedTenantId.value = tenants.value[0].tenant_id
      await loadSelected(mine)
    } catch {
      if (mine === generation) { error.value = LOAD_ERROR; reset() }
    } finally {
      if (mine === generation) loading.value = false
    }
  }

  async function loadSelected(mine: number): Promise<void> {
    const tenantId = selectedTenantId.value
    if (!tenants.value.some((tenant) => tenant.tenant_id === tenantId)) return
    loadingTenant.value = true; truncated.value = false
    try {
      const client = clientFactory()
      const { data: poolRows, error: poolError } = await client.from('pools').select('id, name, status').eq('tenant_id', tenantId).order('created_at', { ascending: false })
      if (mine !== generation) return
      if (poolError) { error.value = POOLS_ERROR; pools.value = []; participants.value = []; return }
      const nextPools = (poolRows ?? []).map(toPool).filter((pool): pool is FinancePool => pool !== null)
      const poolIds = new Set(nextPools.map((pool) => pool.id))
      const rows: FinanceParticipant[] = []
      let cut = false
      for (let page = 0; nextPools.length && page < PARTICIPANT_MAX_PAGES; page += 1) {
        const from = page * PARTICIPANT_PAGE_SIZE
        const { data, error: participantError } = await client.from('participants').select('pool_id, approval_status, payment_status, withdrawn_at').eq('tenant_id', tenantId).order('id').range(from, from + PARTICIPANT_PAGE_SIZE - 1)
        if (mine !== generation) return
        if (participantError) { error.value = POOLS_ERROR; pools.value = []; participants.value = []; return }
        const batch = data ?? []
        for (const row of batch) {
          const participant = toParticipant(row)
          if (participant && poolIds.has(participant.pool_id)) rows.push(participant)
        }
        if (batch.length < PARTICIPANT_PAGE_SIZE) break
        if (page === PARTICIPANT_MAX_PAGES - 1) cut = true
      }
      error.value = ''
      pools.value = nextPools; participants.value = rows; truncated.value = cut
    } catch {
      if (mine === generation) { error.value = POOLS_ERROR; pools.value = []; participants.value = [] }
    } finally {
      if (mine === generation) loadingTenant.value = false
    }
  }

  // Devuelve false (sin consultar nada) si el id no es de una organización que el usuario administra.
  async function selectTenant(tenantId: string): Promise<boolean> {
    if (!tenants.value.some((tenant) => tenant.tenant_id === tenantId)) return false
    if (tenantId === selectedTenantId.value && !error.value) return true
    selectedTenantId.value = tenantId
    pools.value = []; participants.value = []; error.value = ''
    await loadSelected(++generation)
    return true
  }

  async function reloadSelected(): Promise<void> {
    if (!selectedTenant.value) return
    error.value = ''
    await loadSelected(++generation)
  }

  return { tenants, selectedTenantId, selectedTenant, pools, participants, summary, loading, loadingTenant, error, truncated, load, selectTenant, reloadSelected }
}
