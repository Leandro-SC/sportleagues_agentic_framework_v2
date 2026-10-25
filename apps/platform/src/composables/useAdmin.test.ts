import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => h.client }))

import { BRANDING_COLORS_UNAVAILABLE, useAdmin } from './useAdmin'

type Result = { data: unknown; error: { message: string } | null }

// Cliente de Supabase mínimo: cada tabla devuelve un resultado fijo; las RPC se cuentan.
function fakeClient(options: { plan?: 'free' | 'pro'; colors?: Result; assetsRpc?: () => Promise<Result>; participantsRpc?: Result } = {}) {
  const calls = { rpc: [] as Array<{ name: string; args: unknown }>, tables: [] as string[], signed: 0 }
  const plan = options.plan ?? 'pro'
  const tables: Record<string, Result> = {
    tenant_memberships: { data: [{ tenant_id: 'tenant-1', role: 'owner' }], error: null },
    tenant_entitlements: { data: [{ tenant_id: 'tenant-1', plan_code: plan }], error: null },
    pools: { data: [], error: null },
    tenant_branding: options.colors ?? { data: { primary_color: '#112233', secondary_color: '#445566' }, error: null },
  }
  const builder = (result: Result) => {
    const b: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'in', 'order']) b[name] = () => b
    b.maybeSingle = () => Promise.resolve(result)
    b.then = (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
    return b
  }
  const client = {
    from: (table: string) => { calls.tables.push(table); return builder(tables[table] ?? { data: [], error: null }) },
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push({ name, args })
      if (name === 'get_active_branding_assets') return options.assetsRpc ? options.assetsRpc() : { data: [{ asset_id: 'a1', asset_kind: 'logo', storage_path: 'tenant-1/logo.png' }], error: null }
      if (name === 'admin_pool_participants') return options.participantsRpc ?? { data: [], error: null }
      return { data: null, error: null }
    }),
    storage: { from: () => ({ createSignedUrl: async () => { calls.signed += 1; return { data: { signedUrl: `https://signed/${calls.signed}` }, error: null } } }) },
  }
  return { client, calls, assetCalls: () => calls.rpc.filter((call) => call.name === 'get_active_branding_assets').length }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useAdmin - colores de branding (FE-02)', () => {
  it('lee los colores guardados del tenant antes de permitir guardar', async () => {
    const fake = fakeClient(); h.client = fake.client
    const admin = useAdmin()
    expect(admin.brandingColorsStatus.value).toBe('idle')
    await admin.load('u1')
    expect(admin.brandingColorsStatus.value).toBe('ready')
    expect(admin.brandingColors.value).toEqual({ primary: '#112233', secondary: '#445566' })
    expect(fake.calls.tables).toContain('tenant_branding')
    admin.dispose()
  })

  it('un tenant sin fila de branding queda listo con colores nulos (no inventa valores)', async () => {
    h.client = fakeClient({ colors: { data: null, error: null } }).client
    const admin = useAdmin()
    await admin.load('u1')
    expect(admin.brandingColorsStatus.value).toBe('ready')
    expect(admin.brandingColors.value).toEqual({ primary: null, secondary: null })
    admin.dispose()
  })

  it('si no se pueden leer los colores, saveBranding NO llama al RPC y explica por qué', async () => {
    const fake = fakeClient({ colors: { data: null, error: { message: 'boom' } } }); h.client = fake.client
    const admin = useAdmin()
    await admin.load('u1')
    expect(admin.brandingColorsStatus.value).toBe('error')
    expect(await admin.saveBranding('#2C48C7', '#05070D')).toBe(BRANDING_COLORS_UNAVAILABLE)
    expect(fake.calls.rpc.some((call) => call.name === 'update_tenant_branding')).toBe(false)
    admin.dispose()
  })

  it('con los colores cargados envía exactamente lo indicado ("" = sin color) y recuerda lo guardado', async () => {
    const fake = fakeClient(); h.client = fake.client
    const admin = useAdmin()
    await admin.load('u1')
    expect(await admin.saveBranding('#112233', '')).toBeNull()
    const call = fake.calls.rpc.find((entry) => entry.name === 'update_tenant_branding')!
    expect(call.args).toMatchObject({ p_tenant_id: 'tenant-1', p_primary_color: '#112233', p_secondary_color: null })
    expect(admin.brandingColors.value).toEqual({ primary: '#112233', secondary: null })
    admin.dispose()
  })
})

describe('useAdmin - participantes administrativos (UAT-01)', () => {
  it('usa la RPC autorizada y adapta el nombre visible sin embed de profiles', async () => {
    const fake = fakeClient({ participantsRpc: { data: [{ id: 'p1', profile_id: 'u1', display_name: 'Ada', approval_status: 'approved', payment_status: 'paid' }], error: null } }); h.client = fake.client
    const admin = useAdmin({ branding: false })
    admin.selectedPoolId.value = 'pool-1'
    await admin.loadPoolDetails()
    expect(fake.calls.rpc).toContainEqual({ name: 'admin_pool_participants', args: { p_pool_id: 'pool-1' } })
    expect(admin.participants.value).toEqual([expect.objectContaining({ id: 'p1', profiles: { display_name: 'Ada' }, payment_status: 'paid' })])
  })
})

describe('useAdmin - polling de branding (FE-03)', () => {
  it('un tenant PRO se refresca cada 55 s y dispose() lo detiene', async () => {
    const fake = fakeClient(); h.client = fake.client
    const admin = useAdmin()
    await admin.load('u1')
    expect(fake.assetCalls()).toBe(1)
    await vi.advanceTimersByTimeAsync(55_000)
    expect(fake.assetCalls()).toBe(2)
    admin.dispose()
    await vi.advanceTimersByTimeAsync(5 * 55_000)
    expect(fake.assetCalls()).toBe(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('un tenant FREE no arma el polling ni consulta imágenes de marca', async () => {
    const fake = fakeClient({ plan: 'free' }); h.client = fake.client
    const admin = useAdmin()
    await admin.load('u1')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5 * 55_000)
    expect(fake.assetCalls()).toBe(0)
    admin.dispose()
  })

  it('las vistas que no usan branding (branding: false) no leen colores ni arman temporizadores aunque el tenant sea PRO', async () => {
    const fake = fakeClient(); h.client = fake.client
    const admin = useAdmin({ branding: false })
    await admin.load('u1')
    expect(admin.tenants.value).toHaveLength(1)
    expect(fake.assetCalls()).toBe(0)
    expect(fake.calls.tables).not.toContain('tenant_branding')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('una carga en vuelo que termina DESPUÉS de dispose() no vuelve a armar el temporizador', async () => {
    let release!: (value: Result) => void
    const gate = new Promise<Result>((resolve) => { release = resolve })
    const fake = fakeClient({ assetsRpc: () => gate }); h.client = fake.client
    const admin = useAdmin()
    const loading = admin.load('u1')
    await vi.advanceTimersByTimeAsync(0)
    admin.dispose()
    release({ data: [{ asset_id: 'a1', asset_kind: 'logo', storage_path: 'p' }], error: null })
    await loading
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5 * 55_000)
    expect(fake.assetCalls()).toBe(1)
  })

  it('recargar las imágenes no deja temporizadores duplicados', async () => {
    const fake = fakeClient(); h.client = fake.client
    const admin = useAdmin()
    await admin.load('u1')
    await admin.loadBrandingAssets()
    await admin.loadBrandingAssets()
    expect(vi.getTimerCount()).toBe(1)
    admin.dispose()
  })
})

describe('useAdmin - cambio de identidad (FE-05)', () => {
  it('reset() vacía todo, detiene el polling y descarta una carga anterior en vuelo', async () => {
    let release!: (value: Result) => void
    const gate = new Promise<Result>((resolve) => { release = resolve })
    const fake = fakeClient({ assetsRpc: () => gate }); h.client = fake.client
    const admin = useAdmin()
    const stale = admin.load('userA')
    await vi.advanceTimersByTimeAsync(0)
    admin.reset()
    expect(admin.tenants.value).toEqual([])
    expect(admin.selectedTenantId.value).toBe('')
    release({ data: [], error: null })
    await stale
    expect(admin.loading.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    admin.dispose()
  })
})
