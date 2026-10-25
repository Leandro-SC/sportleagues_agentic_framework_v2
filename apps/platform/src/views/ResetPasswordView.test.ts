import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ResetPasswordView from './ResetPasswordView.vue'

const h = vi.hoisted(() => ({ cancelRecovery: vi.fn(), clearRecovery: vi.fn(), updatePassword: vi.fn(), continueAfterSignIn: vi.fn() }))
vi.mock('../composables/useAuth', () => ({
  useAuth: () => ({ state: { user: { id: 'u1' }, profile: { id: 'u1', display_name: 'Ana' }, recovery: true }, cancelRecovery: h.cancelRecovery, clearRecovery: h.clearRecovery, updatePassword: h.updatePassword }),
}))
vi.mock('../composables/usePostSignInNavigation', () => ({ usePostSignInNavigation: () => ({ continueAfterSignIn: h.continueAfterSignIn }) }))

async function mountView() {
  const Blank = { template: '<div />' }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/auth/reset', name: 'reset-password', component: ResetPasswordView }, { path: '/', name: 'home', component: Blank }] })
  await router.push('/auth/reset'); await router.isReady()
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  h.cancelRecovery.mockReset().mockResolvedValue(undefined)
  h.clearRecovery.mockReset()
  h.updatePassword.mockReset().mockResolvedValue(null)
  h.continueAfterSignIn.mockReset().mockResolvedValue(undefined)
})

describe('ResetPasswordView (FE-09)', () => {
  it('«Cancelar» cierra la sesión de recuperación (no solo sale del modo) y vuelve a Inicio', async () => {
    const { wrapper, router } = await mountView()
    await wrapper.findAll('button').find((button) => button.text() === 'Cancelar')!.trigger('click')
    await flushPromises()
    expect(h.cancelRecovery).toHaveBeenCalledTimes(1)
    expect(h.clearRecovery).not.toHaveBeenCalled() // clearRecovery solo descartaba el modo y dejaba la sesión abierta
    expect(router.currentRoute.value.name).toBe('home')
  })

  it('guardar la contraseña válida continúa el flujo normal', async () => {
    const { wrapper } = await mountView()
    await wrapper.get('#new-password').setValue('Nueva12345'); await wrapper.get('#confirm-new-password').setValue('Nueva12345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(h.updatePassword).toHaveBeenCalledWith('Nueva12345')
    expect(h.continueAfterSignIn).toHaveBeenCalledTimes(1)
    expect(h.cancelRecovery).not.toHaveBeenCalled()
  })
})
