import { describe, expect, it } from 'vitest'
import { createFakeFinanceClient } from '../test-support/fake-finance-client'
import { PARTICIPANT_PAGE_SIZE, useAdminFinance } from './useAdminFinance'

const ME = 'me'
const memberships = [
  { tenant_id: 'tA', profile_id: ME, role: 'owner', is_active: true },
  { tenant_id: 'tB', profile_id: ME, role: 'admin', is_active: true },
  { tenant_id: 'tC', profile_id: ME, role: 'member', is_active: true },
  { tenant_id: 'tD', profile_id: ME, role: 'owner', is_active: false },
  { tenant_id: 'tX', profile_id: 'otro', role: 'owner', is_active: true },
]
const tenants = [{ id: 'tA', name: 'Liga Norte' }, { id: 'tB', name: 'Liga Sur' }, { id: 'tX', name: 'Ajena' }]
const pools = [
  { id: 'a1', tenant_id: 'tA', name: 'Quiniela A1', status: 'open' },
  { id: 'b1', tenant_id: 'tB', name: 'Quiniela B1', status: 'draft' },
  { id: 'x1', tenant_id: 'tX', name: 'Quiniela ajena', status: 'open' },
]
const participants = [
  { id: '1', tenant_id: 'tA', pool_id: 'a1', approval_status: 'approved', payment_status: 'paid', withdrawn_at: null },
  { id: '2', tenant_id: 'tA', pool_id: 'a1', approval_status: 'approved', payment_status: 'pending', withdrawn_at: null },
  { id: '3', tenant_id: 'tB', pool_id: 'b1', approval_status: 'pending', payment_status: 'invited', withdrawn_at: null },
  { id: '4', tenant_id: 'tX', pool_id: 'x1', approval_status: 'approved', payment_status: 'paid', withdrawn_at: null },
]

function setup(options?: Parameters<typeof createFakeFinanceClient>[1], data = { tenant_memberships: memberships, tenants, pools, participants }) {
  const fake = createFakeFinanceClient(data, options)
  return { ...fake, finance: useAdminFinance(() => fake.client) }
}

describe('useAdminFinance', () => {
  it('builds the organization list only from the user’s active admin memberships', async () => {
    const { finance } = setup()
    await finance.load(ME)
    expect(finance.tenants.value.map((tenant) => tenant.tenant_id)).toEqual(['tA', 'tB'])
    expect(finance.tenants.value.map((tenant) => tenant.name)).toEqual(['Liga Norte', 'Liga Sur'])
    expect(finance.selectedTenantId.value).toBe('tA')
  })

  it('summarizes the manual payment state of the selected organization’s pools', async () => {
    const { finance } = setup()
    await finance.load(ME)
    expect(finance.pools.value.map((pool) => pool.id)).toEqual(['a1'])
    expect(finance.summary.value.totals).toMatchObject({ total: 2, paid: 1, pending: 1, invited: 0 })
    expect(finance.error.value).toBe('')
  })

  it('ignores a foreign tenant id: no state change and no query is sent', async () => {
    const { finance, queries } = setup()
    await finance.load(ME)
    const before = queries.length
    expect(await finance.selectTenant('tX')).toBe(false)
    expect(await finance.selectTenant('tC')).toBe(false) // miembro sin rol admin
    expect(await finance.selectTenant('tD')).toBe(false) // membresía inactiva
    expect(await finance.selectTenant("tA' or 1=1")).toBe(false)
    expect(finance.selectedTenantId.value).toBe('tA')
    expect(queries).toHaveLength(before)
    expect(queries.some((query) => Object.values(query.eq).includes('tX'))).toBe(false)
  })

  it('switches between the user’s own organizations and reloads only that tenant', async () => {
    const { finance, queries } = setup()
    await finance.load(ME)
    expect(await finance.selectTenant('tB')).toBe(true)
    expect(finance.selectedTenantId.value).toBe('tB')
    expect(finance.pools.value.map((pool) => pool.id)).toEqual(['b1'])
    expect(finance.summary.value.totals).toMatchObject({ total: 1, invited: 1, awaitingApproval: 1 })
    const tenantScoped = queries.filter((query) => query.table === 'pools' || query.table === 'participants')
    expect(tenantScoped.every((query) => query.eq.tenant_id === 'tA' || query.eq.tenant_id === 'tB')).toBe(true)
  })

  it('shows an empty list (no error) when the user administers nothing', async () => {
    const { finance } = setup(undefined, { tenant_memberships: [{ tenant_id: 'tC', profile_id: ME, role: 'member', is_active: true }], tenants, pools, participants })
    await finance.load(ME)
    expect(finance.tenants.value).toEqual([])
    expect(finance.error.value).toBe('')
    expect(finance.loading.value).toBe(false)
  })

  it('an organization without pools yields no pools and zero totals', async () => {
    const { finance } = setup(undefined, { tenant_memberships: memberships, tenants, pools: [], participants: [] })
    await finance.load(ME)
    expect(finance.pools.value).toEqual([])
    expect(finance.summary.value.totals.total).toBe(0)
  })

  it('reports a generic error when memberships cannot be read, without leaking the server message', async () => {
    const { finance } = setup({ failTables: ['tenant_memberships'] })
    await finance.load(ME)
    expect(finance.error.value).toMatch(/No fue posible cargar tus finanzas/)
    expect(finance.error.value).not.toContain('boom')
    expect(finance.tenants.value).toEqual([])
  })

  it('reports an error when the pools of the selected organization cannot be read', async () => {
    const { finance } = setup({ failTables: ['pools'] })
    await finance.load(ME)
    expect(finance.error.value).toMatch(/quinielas/)
    expect(finance.pools.value).toEqual([])
    expect(finance.tenants.value).toHaveLength(2) // el selector sigue disponible para reintentar
  })

  it('survives a network failure (thrown) with a generic error and a usable state', async () => {
    const { finance } = setup({ throwTables: ['tenant_memberships'] })
    await finance.load(ME)
    expect(finance.error.value).toMatch(/No fue posible cargar tus finanzas/)
    expect(finance.loading.value).toBe(false)
  })

  it('falls back to a short id when tenant names cannot be read', async () => {
    const { finance } = setup(undefined, { tenant_memberships: memberships, tenants: [], pools, participants })
    await finance.load(ME)
    expect(finance.tenants.value.map((tenant) => tenant.name)).toEqual([null, null])
  })

  it('pages through participants beyond the PostgREST row cap instead of silently undercounting', async () => {
    const many = Array.from({ length: PARTICIPANT_PAGE_SIZE + 5 }, (_, index) => ({ id: String(index).padStart(5, '0'), tenant_id: 'tA', pool_id: 'a1', approval_status: 'approved', payment_status: 'paid', withdrawn_at: null }))
    const { finance, queries } = setup(undefined, { tenant_memberships: memberships, tenants, pools, participants: many })
    await finance.load(ME)
    expect(finance.summary.value.totals.paid).toBe(PARTICIPANT_PAGE_SIZE + 5)
    expect(finance.truncated.value).toBe(false)
    expect(queries.filter((query) => query.table === 'participants')).toHaveLength(2)
  })

  it('discards rows of pools that do not belong to the selected organization', async () => {
    const stray = [...participants, { id: '9', tenant_id: 'tA', pool_id: 'x1', approval_status: 'approved', payment_status: 'paid', withdrawn_at: null }]
    const { finance } = setup(undefined, { tenant_memberships: memberships, tenants, pools, participants: stray })
    await finance.load(ME)
    expect(finance.summary.value.totals.total).toBe(2)
  })
})
