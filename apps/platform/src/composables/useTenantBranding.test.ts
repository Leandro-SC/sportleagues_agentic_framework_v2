import { describe, expect, it } from 'vitest'
import { useTenantBranding } from './useTenantBranding'

type Rows = Record<string, unknown[]>

// Cliente falso: cada tabla devuelve sus filas; los filtros se ignoran salvo `pool_join_codes`, que imita RLS (solo admins).
function fakeClient(rows: Rows, opts: { admin?: boolean; assets?: unknown[] } = {}) {
  const chain = (table: string) => {
    const data = table === 'pool_join_codes' && !opts.admin ? [] : rows[table] ?? []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'or', 'order', 'limit']) q[m] = () => q
    q.maybeSingle = async () => ({ data: data[0] ?? null, error: null })
    q.then = (resolve: (v: unknown) => void) => resolve({ data, error: null })
    return q
  }
  return {
    from: chain,
    rpc: async () => ({ data: opts.assets ?? [], error: null }),
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }) }) },
  } as never
}

const base: Rows = {
  pools: [{ tenant_id: 't1' }],
  tenant_entitlements: [{ plan_code: 'pro' }],
  tenant_branding: [{ brand_name: 'Quinielas Silva', primary_color: '#FFCC00' }],
  pool_join_codes: [{ code: 'ABC123' }],
}

describe('useTenantBranding', () => {
  it('PRO: nombre, color legible, logo y banner firmados', async () => {
    const t = useTenantBranding(() => fakeClient(base, { assets: [{ asset_kind: 'logo', storage_path: 't1/logo.webp' }, { asset_kind: 'banner', storage_path: 't1/banner.webp' }] }))
    await t.load('pool-1')
    expect(t.branding.value).toMatchObject({ tenantId: 't1', plan: 'pro', brandName: 'Quinielas Silva', accent: '#ffcc00', logoUrl: 'https://signed/t1/logo.webp', bannerUrl: 'https://signed/t1/banner.webp', joinCode: null })
  })

  it('FREE: el nombre se ve, pero sin color ni imágenes', async () => {
    const t = useTenantBranding(() => fakeClient({ ...base, tenant_entitlements: [{ plan_code: 'free' }] }, { assets: [{ asset_kind: 'logo', storage_path: 'x' }] }))
    await t.load('pool-1')
    expect(t.branding.value).toMatchObject({ plan: 'free', brandName: 'Quinielas Silva', accent: null, logoUrl: null })
  })

  it('el código de unión solo llega a quien RLS se lo deja leer (organizador)', async () => {
    const admin = useTenantBranding(() => fakeClient(base, { admin: true }))
    await admin.load('pool-1')
    expect(admin.branding.value?.joinCode).toBe('ABC123')
  })

  it('un fallo deja la marca por defecto sin romper la vista', async () => {
    const t = useTenantBranding(() => { throw new Error('sin red') })
    await t.load('pool-1')
    expect(t.branding.value).toBeNull()
    expect(t.loading.value).toBe(false)
  })
})
