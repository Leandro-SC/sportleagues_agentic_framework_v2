import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createFakeFinanceClient, type RecordedQuery } from '../test-support/fake-finance-client'
import AdminIncomeView from './AdminIncomeView.vue'

const h = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => h.client, hasSupabaseConfiguration: () => true }))
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: { profile: { id: 'me', display_name: 'Ana' }, user: { id: 'me' } }, isAuthenticated: { value: true } }) }))

const memberships = [
  { tenant_id: 'tA', profile_id: 'me', role: 'owner', is_active: true },
  { tenant_id: 'tB', profile_id: 'me', role: 'admin', is_active: true },
]
const tenants = [{ id: 'tA', name: 'Liga Norte' }, { id: 'tB', name: 'Liga Sur' }, { id: 'tX', name: 'Organización ajena' }]
const pools = [
  { id: 'a1', tenant_id: 'tA', name: 'Quiniela Norte 1', status: 'open' },
  { id: 'a2', tenant_id: 'tA', name: 'Quiniela Norte 2', status: 'draft' },
  { id: 'b1', tenant_id: 'tB', name: 'Quiniela Sur', status: 'open' },
  { id: 'x1', tenant_id: 'tX', name: 'Quiniela ajena secreta', status: 'open' },
]
const p = (id: string, tenant: string, pool: string, payment: string, approval = 'approved') => ({ id, tenant_id: tenant, pool_id: pool, payment_status: payment, approval_status: approval, withdrawn_at: null })
const participants = [
  p('1', 'tA', 'a1', 'paid'), p('2', 'tA', 'a1', 'paid'), p('3', 'tA', 'a1', 'pending', 'pending'), p('4', 'tA', 'a2', 'invited'),
  p('5', 'tB', 'b1', 'pending'),
  p('6', 'tX', 'x1', 'paid'),
]

let queries: RecordedQuery[] = []

function useData(data: Parameters<typeof createFakeFinanceClient>[0], options?: Parameters<typeof createFakeFinanceClient>[1]) {
  const fake = createFakeFinanceClient(data, options)
  h.client = fake.client
  queries = fake.queries
}

async function mountView(url = '/admin/ingresos') {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/ingresos', name: 'admin-income', component: AdminIncomeView },
    ...['home', 'admin', 'organizer-dashboard', 'admin-fixture', 'profile'].map((name) => ({ path: name === 'home' ? '/' : `/${name}`, name, component: Blank })),
  ] })
  await router.push(url); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return wrapper
}

beforeEach(() => { useData({ tenant_memberships: memberships, tenants, pools, participants }) })

describe('AdminIncomeView «Mis finanzas»', () => {
  it('shows read-only counts of the manual payment state, per organization and per pool', async () => {
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Mis finanzas')
    expect(wrapper.get('[data-test="total-participants"]').text()).toBe('4')
    expect(wrapper.get('[data-test="total-paid"]').text()).toBe('2')
    expect(wrapper.get('[data-test="total-pending"]').text()).toBe('1')
    expect(wrapper.get('[data-test="total-invited"]').text()).toBe('1')
    expect(wrapper.get('[data-test="total-awaiting"]').text()).toBe('1')
    expect(wrapper.get('[data-test="pool-a1"]').text()).toContain('Quiniela Norte 1')
    expect(wrapper.get('[data-test="pool-a1"]').text()).toContain('Abierta')
    expect(wrapper.get('[data-test="pool-a2"]').text()).toContain('Borrador')
    expect(wrapper.text()).toContain('no cobra ni procesa pagos')
  })

  it('is read-only: it offers no payment editing controls', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('select option[value="paid"]').exists()).toBe(false)
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('never renders a monetary figure', async () => {
    const wrapper = await mountView()
    const text = wrapper.text()
    expect(text).not.toMatch(/[$€£]/)
    expect(text).not.toMatch(/\bS\/|\bUSD\b|\bPEN\b|\bMXN\b|\bsoles\b|\bdólares\b/i)
    expect(text).not.toMatch(/\d+[.,]\d{2}\b/)
    expect(text).not.toMatch(/Próximamente: resumen de ventas|Ingresos aún no disponibles/)
  })

  it('builds the selector only from the user’s admin memberships', async () => {
    const wrapper = await mountView()
    const options = wrapper.findAll('select option')
    expect(options.map((option) => option.text())).toEqual(['Liga Norte', 'Liga Sur'])
    expect(options.map((option) => option.attributes('value'))).toEqual(['tA', 'tB'])
  })

  it('ignores a foreign tenant id supplied in the URL query: it is never queried nor shown', async () => {
    const wrapper = await mountView('/admin/ingresos?tenant=tX&tenant_id=tX&tenantId=tX&pool=x1')
    expect(wrapper.text()).not.toContain('ajena')
    expect(wrapper.text()).not.toContain('Quiniela ajena secreta')
    expect(wrapper.findAll('select option').map((option) => option.attributes('value'))).not.toContain('tX')
    expect(queries.some((query) => Object.values(query.eq).includes('tX') || Object.values(query.inFilter).some((values) => values.includes('tX')))).toBe(false)
    expect(wrapper.get('[data-test="total-participants"]').text()).toBe('4')
  })

  it('ignores a foreign tenant id forced through the selector DOM value', async () => {
    const wrapper = await mountView()
    const select = wrapper.get('select')
    const before = queries.length
    const foreign = document.createElement('option'); foreign.value = 'tX'; foreign.textContent = 'Organización ajena'
    select.element.appendChild(foreign)
    await select.setValue('tX')
    await flushPromises()
    expect(queries.length).toBe(before)
    expect(wrapper.text()).not.toContain('Quiniela ajena secreta')
    expect(wrapper.get('[data-test="total-participants"]').text()).toBe('4')
  })

  it('switching to another own organization loads that organization’s pools', async () => {
    const wrapper = await mountView()
    await wrapper.get('select').setValue('tB')
    await flushPromises()
    expect(wrapper.get('[data-test="pool-b1"]').text()).toContain('Quiniela Sur')
    expect(wrapper.find('[data-test="pool-a1"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="total-participants"]').text()).toBe('1')
  })

  it('shows the empty state when the user administers no organization', async () => {
    useData({ tenant_memberships: [{ tenant_id: 'tA', profile_id: 'me', role: 'member', is_active: true }], tenants, pools, participants })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Sin organizaciones administrables')
    expect(wrapper.find('[data-test="finance-totals"]').exists()).toBe(false)
  })

  it('shows the empty state when the organization has no pools yet', async () => {
    useData({ tenant_memberships: memberships, tenants, pools: [], participants: [] })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain('Esta organización aún no tiene quinielas')
    expect(wrapper.find('[data-test="finance-totals"]').exists()).toBe(false)
  })

  it('shows "Sin participantes todavía" for a pool with no enrolled players', async () => {
    useData({ tenant_memberships: memberships, tenants, pools, participants: [] })
    const wrapper = await mountView()
    expect(wrapper.get('[data-test="pool-a1"]').text()).toContain('Sin participantes todavía')
  })

  it('shows a retryable error when the data cannot be loaded, and recovers on retry', async () => {
    useData({ tenant_memberships: memberships, tenants, pools, participants }, { failTables: ['tenant_memberships'] })
    const wrapper = await mountView()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/No fue posible cargar tus finanzas/)
    expect(wrapper.find('[data-test="finance-totals"]').exists()).toBe(false)
    useData({ tenant_memberships: memberships, tenants, pools, participants })
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Reintentar')!
    await retry.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="total-participants"]').text()).toBe('4')
  })

  it('shows an error (not stale data) when the pools query fails but keeps the selector', async () => {
    useData({ tenant_memberships: memberships, tenants, pools, participants }, { failTables: ['pools'] })
    const wrapper = await mountView()
    expect(wrapper.get('[role="alert"]').text()).toMatch(/quinielas/)
    expect(wrapper.find('[data-test="finance-totals"]').exists()).toBe(false)
    expect(wrapper.findAll('select option')).toHaveLength(2)
  })

  it('renders inside the organizer navigation with a clear exit to participant mode', async () => {
    const wrapper = await mountView()
    expect(wrapper.find('nav[aria-label="Navegación del organizador"]').exists()).toBe(true)
    expect(wrapper.get('[data-test="exit-admin-mode"]').attributes('href')).toBe('/')
    expect(wrapper.get('nav [aria-current="page"]').text()).toBe('Finanzas')
  })
})
