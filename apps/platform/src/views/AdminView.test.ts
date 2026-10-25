import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import AdminView from './AdminView.vue'

const h = vi.hoisted(() => ({ admin: {} as Record<string, any>, auth: {} as Record<string, any> }))

vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ state: h.auth, isAuthenticated: { value: true } }) }))
vi.mock('../composables/useAdmin', async (importOriginal) => ({ ...(await importOriginal<typeof import('../composables/useAdmin')>()), useAdmin: () => h.admin }))

function setup(overrides: Record<string, unknown> = {}) {
  h.auth = reactive({ user: { id: 'u1' }, profile: { id: 'u1', display_name: 'Ana Pérez' } })
  const tenants = ref([{ tenant_id: 'tenant-1234', role: 'owner', plan_code: 'pro' }])
  const selectedTenantId = ref('tenant-1234')
  const pools = ref([{ id: 'pool-1', tenant_id: 'tenant-1234', name: 'Quiniela A', status: 'open', lock_offset: '00:15:00', requires_approval: false, ticketing_mode: 'none' }])
  const selectedPoolId = ref('pool-1')
  h.admin = {
    tenants, selectedTenantId, pools, selectedPoolId,
    selectedTenant: computed(() => tenants.value.find((tenant) => tenant.tenant_id === selectedTenantId.value) ?? null),
    selectedPool: computed(() => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null),
    participants: ref([]), rule: ref({ exact_points: 3, outcome_points: 1, tie_breaker: 'exact_predictions' }), rulesPolicy: ref(null), activePools: computed(() => 1),
    loading: ref(false), saving: ref(false), brandingSaving: ref(false), error: ref(''), brandingAssets: ref({ logo: null, banner: null }),
    brandingColors: ref({ primary: '#112233', secondary: '#445566' }), brandingColorsStatus: ref('ready'),
    load: vi.fn().mockResolvedValue(undefined), loadPools: vi.fn().mockResolvedValue(undefined), loadBrandingAssets: vi.fn().mockResolvedValue(undefined),
    loadBrandingColors: vi.fn().mockResolvedValue(undefined), loadPoolDetails: vi.fn().mockResolvedValue(undefined),
    createPool: vi.fn().mockResolvedValue(null), updatePool: vi.fn().mockResolvedValue(null), publishRules: vi.fn().mockResolvedValue(null),
    saveBranding: vi.fn().mockResolvedValue(null), createJoinCode: vi.fn().mockResolvedValue({ code: null, error: null }),
    approveParticipant: vi.fn().mockResolvedValue(null), setPayment: vi.fn().mockResolvedValue(null),
    uploadBrandingAsset: vi.fn().mockResolvedValue(null), removeBrandingAsset: vi.fn().mockResolvedValue(null),
    reset: vi.fn(), dispose: vi.fn(), ...overrides,
  }
}

async function mountView() {
  const Blank = { template: '<div />' }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/admin', name: 'admin', component: AdminView }, { path: '/admin/parrilla', name: 'admin-fixture', component: Blank }, { path: '/organizador', name: 'organizer-dashboard', component: Blank },
      { path: '/admin/ingresos', name: 'admin-income', component: Blank }, { path: '/', name: 'home', component: Blank }, { path: '/partidos', name: 'matches', component: Blank },
      { path: '/ligas', name: 'leagues', component: Blank }, { path: '/mis-puntos', name: 'points', component: Blank }, { path: '/perfil', name: 'profile', component: Blank },
    ],
  })
  await router.push('/admin'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router], stubs: { PoolTicketsAdmin: true } } })
  await flushPromises()
  return { wrapper, router }
}

const admin = () => h.admin
const buttonByText = (wrapper: ReturnType<typeof mount>, text: string) => wrapper.findAll('button').find((button) => button.text() === text)!

beforeEach(() => setup())

describe('AdminView - campos numéricos vacíos no son 0 (FE-01)', () => {
  it('un bloqueo en blanco no llama a manage_pool y muestra el error', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('#admin-pool-name').setValue('Quiniela A')
    await wrapper.get('#admin-lock-minutes').setValue('')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(admin().updatePool).not.toHaveBeenCalled()
    expect(admin().createPool).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('bloqueo')
  })

  it('un bloqueo válido sí se envía (incluido 0 escrito explícitamente)', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('#admin-pool-name').setValue('Quiniela A')
    await wrapper.get('#admin-lock-minutes').setValue('0')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(admin().updatePool).toHaveBeenCalledWith('update', 'Quiniela A', 0, false)
  })

  it.each(['1441', '-1', '1.5', 'abc'])('rechaza un bloqueo %j sin llamar al servidor', async (value) => {
    const { wrapper } = await mountView()
    await wrapper.get('#admin-pool-name').setValue('Quiniela A')
    await wrapper.get('#admin-lock-minutes').setValue(value)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(admin().updatePool).not.toHaveBeenCalled()
  })

  it('puntos en blanco no publican una versión de reglas con 0 puntos', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('#exact-points').setValue('')
    await buttonByText(wrapper, 'Publicar nueva versión').trigger('click')
    await flushPromises()
    expect(admin().publishRules).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Puntos exacto')

    await wrapper.get('#exact-points').setValue('3'); await wrapper.get('#outcome-points').setValue('  ')
    await buttonByText(wrapper, 'Publicar nueva versión').trigger('click')
    await flushPromises()
    expect(admin().publishRules).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('Puntos 1X2')
  })

  it('puntos válidos (0 explícito incluido) sí se publican', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('#exact-points').setValue('5'); await wrapper.get('#outcome-points').setValue('0')
    await buttonByText(wrapper, 'Publicar nueva versión').trigger('click')
    await flushPromises()
    expect(admin().publishRules).toHaveBeenCalledWith(5, 0, 'exact_predictions')
  })
})

describe('AdminView - «Guardar branding» no pisa los colores reales (FE-02)', () => {
  it('el formulario parte de los colores guardados del tenant y los reenvía tal cual', async () => {
    const { wrapper } = await mountView()
    expect((wrapper.get('#primary-color').element as HTMLInputElement).value).toBe('#112233')
    expect((wrapper.get('#secondary-color').element as HTMLInputElement).value).toBe('#445566')
    await buttonByText(wrapper, 'Guardar branding').trigger('click')
    await flushPromises()
    expect(admin().saveBranding).toHaveBeenCalledWith('#112233', '#445566')
    expect(admin().saveBranding).not.toHaveBeenCalledWith('#2C48C7', '#05070D')
  })

  it('solo cambia lo que el usuario editó', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('#secondary-color').setValue('#ABCDEF')
    await buttonByText(wrapper, 'Guardar branding').trigger('click')
    await flushPromises()
    expect(admin().saveBranding).toHaveBeenCalledWith('#112233', '#ABCDEF')
  })

  it('si los colores actuales no se pudieron cargar bloquea el guardado y lo explica', async () => {
    setup({ brandingColors: ref(null), brandingColorsStatus: ref('error') })
    const { wrapper } = await mountView()
    const save = buttonByText(wrapper, 'Guardar branding')
    expect(save.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('No pudimos cargar los colores actuales')
    await save.trigger('click')
    await flushPromises()
    expect(admin().saveBranding).not.toHaveBeenCalled()
  })

  it('un tenant sin colores guardados muestra los campos vacíos, no valores de ejemplo', async () => {
    setup({ brandingColors: ref({ primary: null, secondary: null }) })
    const { wrapper } = await mountView()
    expect((wrapper.get('#primary-color').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('#secondary-color').element as HTMLInputElement).value).toBe('')
  })
})

describe('AdminView - ciclo de vida y cargas (FE-03)', () => {
  it('detiene el polling de branding al desmontar', async () => {
    const { wrapper } = await mountView()
    expect(admin().dispose).not.toHaveBeenCalled()
    wrapper.unmount()
    expect(admin().dispose).toHaveBeenCalledTimes(1)
  })

  it('no duplica la carga: el selectedTenantId que fija load() no dispara una segunda carga', async () => {
    setup({ selectedTenantId: ref('') })
    const a = admin()
    a.load = vi.fn(async () => { a.loading.value = true; a.selectedTenantId.value = 'tenant-1234'; await Promise.resolve(); await Promise.resolve(); a.loading.value = false })
    await mountView()
    expect(a.load).toHaveBeenCalledTimes(1)
    expect(a.loadPools).not.toHaveBeenCalled()
    expect(a.loadBrandingAssets).not.toHaveBeenCalled()
    expect(a.loadBrandingColors).not.toHaveBeenCalled()
  })

  it('cambiar de organización con el selector sí recarga pools, branding y colores', async () => {
    setup()
    admin().tenants.value = [{ tenant_id: 'tenant-1234', role: 'owner', plan_code: 'pro' }, { tenant_id: 'tenant-9999', role: 'admin', plan_code: 'free' }]
    const { wrapper } = await mountView()
    await wrapper.get('select').setValue('tenant-9999')
    await flushPromises()
    expect(admin().loadPools).toHaveBeenCalledTimes(1)
    expect(admin().loadBrandingAssets).toHaveBeenCalledTimes(1)
    expect(admin().loadBrandingColors).toHaveBeenCalledTimes(1)
  })
})

describe('AdminView - cambio de identidad con la vista montada (FE-05)', () => {
  it('otro usuario: descarta lo cargado, limpia formularios y recarga con el nuevo id', async () => {
    const { wrapper } = await mountView()
    expect(admin().load).toHaveBeenCalledTimes(1)
    expect(admin().load).toHaveBeenLastCalledWith('u1')
    await wrapper.get('#exact-points').setValue('9')
    h.auth.user = { id: 'u2' }
    await flushPromises()
    expect(admin().reset).toHaveBeenCalledTimes(1)
    expect(admin().load).toHaveBeenCalledTimes(2)
    expect(admin().load).toHaveBeenLastCalledWith('u2')
  })

  it('sin sesión: libera los datos y vuelve a Inicio', async () => {
    const { router } = await mountView()
    h.auth.user = null
    await flushPromises()
    expect(admin().reset).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('el mismo usuario (p. ej. refresco de token) no reinicia nada', async () => {
    await mountView()
    h.auth.user = { id: 'u1' }
    await flushPromises()
    expect(admin().reset).not.toHaveBeenCalled()
    expect(admin().load).toHaveBeenCalledTimes(1)
  })
})

describe('AdminView - reglas congeladas y puntuación estándar (ADR-023)', () => {
  it('tras el primer lock muestra las reglas como fijas y no ofrece publicar', async () => {
    setup({ rulesPolicy: ref({ editable: false, customAllowed: true }) })
    const { wrapper } = await mountView()
    expect(wrapper.get('[data-testid="rules-frozen"]').text()).toContain('fijas')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Publicar nueva versión')).toBe(false)
    expect((wrapper.get('#exact-points').element as HTMLInputElement).disabled).toBe(true)
  })

  it('en FREE los puntos son los estándar y solo se elige el desempate', async () => {
    setup({ rulesPolicy: ref({ editable: true, customAllowed: false }) })
    const { wrapper } = await mountView()
    expect(wrapper.get('[data-testid="rules-standard"]').text()).toContain('PRO')
    expect((wrapper.get('#outcome-points').element as HTMLInputElement).disabled).toBe(true)
    await wrapper.get('#tie-breaker').setValue('prediction_submitted_at')
    await buttonByText(wrapper, 'Publicar nueva versión').trigger('click')
    await flushPromises()
    expect(admin().publishRules).toHaveBeenCalledWith(3, 1, 'prediction_submitted_at')
  })

  it('el marcador exacto no puede valer menos que el resultado', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('#exact-points').setValue('1'); await wrapper.get('#outcome-points').setValue('2')
    await buttonByText(wrapper, 'Publicar nueva versión').trigger('click')
    await flushPromises()
    expect(admin().publishRules).not.toHaveBeenCalled()
  })
})

describe('AdminView - nombre de la plataforma (ADR-024)', () => {
  it('carga el nombre guardado y lo guarda en todos los planes', async () => {
    setup({ brandName: ref('Quinielas Silva'), saveBrandName: vi.fn().mockResolvedValue(null), tenants: ref([{ tenant_id: 'tenant-1234', role: 'owner', plan_code: 'free' }]) })
    const { wrapper } = await mountView()
    const input = wrapper.get('#brand-name')
    expect((input.element as HTMLInputElement).value).toBe('Quinielas Silva')
    await input.setValue('Liga Silva')
    await wrapper.get('[data-testid="save-brand-name"]').trigger('click')
    await flushPromises()
    expect(admin().saveBrandName).toHaveBeenCalledWith('Liga Silva')
  })

  it('muestra el rechazo del servidor', async () => {
    setup({ brandName: ref(null), saveBrandName: vi.fn().mockResolvedValue('El nombre de tu plataforma debe tener entre 2 y 60 caracteres.') })
    const { wrapper } = await mountView()
    await wrapper.get('#brand-name').setValue('X')
    await wrapper.get('[data-testid="save-brand-name"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('entre 2 y 60')
  })
})
