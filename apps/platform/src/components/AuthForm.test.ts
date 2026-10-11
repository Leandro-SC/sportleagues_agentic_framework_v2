import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  signUpWithPassword: vi.fn(),
  signInWithPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  signInWithGoogle: vi.fn(),
}))
const continueAfterSignIn = vi.hoisted(() => vi.fn())

vi.mock('../composables/useAuth', () => ({ useAuth: () => auth }))
vi.mock('../composables/usePostSignInNavigation', () => ({ usePostSignInNavigation: () => ({ continueAfterSignIn }) }))

import AuthForm, { type AuthMode } from './AuthForm.vue'

function mountForm(mode: AuthMode = 'sign-in') {
  return mount(AuthForm, { props: { mode, 'onUpdate:mode': (value: AuthMode) => wrapper.setProps({ mode: value }) } })
}
let wrapper: ReturnType<typeof mountForm>

async function type(id: string, value: string) {
  await wrapper.get(`#${id}`).setValue(value)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AuthForm — sign-in', () => {
  it('offers email, password, recovery, sign-up link and Google; no Magic Link', () => {
    wrapper = mountForm('sign-in')
    expect(wrapper.find('#email').exists()).toBe(true)
    expect(wrapper.find('#password').attributes('type')).toBe('password')
    expect(wrapper.text()).toContain('¿Olvidaste tu contraseña?')
    expect(wrapper.text()).toContain('Crear cuenta')
    expect(wrapper.text()).toContain('Continuar con Google')
    expect(wrapper.text()).not.toMatch(/magic/i)
  })

  it('validates before calling Supabase', async () => {
    wrapper = mountForm('sign-in')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Ingresa tu correo electrónico.')
    expect(wrapper.text()).toContain('Ingresa tu contraseña.')
  })

  it('continues after a correct login and clears the password field', async () => {
    auth.signInWithPassword.mockResolvedValue(null)
    wrapper = mountForm('sign-in')
    await type('email', 'ada@example.com'); await type('password', 'Secreta123')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signInWithPassword).toHaveBeenCalledWith('ada@example.com', 'Secreta123')
    expect(continueAfterSignIn).toHaveBeenCalledOnce()
    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('')
  })

  it('shows the error and does not navigate after a wrong password', async () => {
    auth.signInWithPassword.mockResolvedValue('Correo o contraseña incorrectos.')
    wrapper = mountForm('sign-in')
    await type('email', 'ada@example.com'); await type('password', 'mala')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Correo o contraseña incorrectos.')
    expect(continueAfterSignIn).not.toHaveBeenCalled()
  })

  it('starts Google OAuth', async () => {
    auth.signInWithGoogle.mockResolvedValue(null)
    wrapper = mountForm('sign-in')
    const google = wrapper.findAll('button').find((button) => button.text().includes('Google'))!
    await google.trigger('click')
    expect(auth.signInWithGoogle).toHaveBeenCalledOnce()
  })
})

describe('AuthForm — reference layout and remember-me', () => {
  it('shows the welcome heading, remember checkbox (on by default), recovery link, Google and the create-account card', () => {
    localStorage.clear()
    wrapper = mountForm('sign-in')
    expect(wrapper.get('h2').text()).toBe('Bienvenido')
    expect(wrapper.text()).toContain('Inicia sesión para continuar')
    expect(wrapper.text()).toContain('Recordar mi cuenta')
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('¿No tienes cuenta?')
    expect(wrapper.text()).toContain('Crea tu cuenta en segundos')
  })

  it('toggles password visibility with an accessible button', async () => {
    wrapper = mountForm('sign-in')
    const toggle = () => wrapper.get('button[aria-label$="contraseña"]')
    expect(wrapper.get('#password').attributes('type')).toBe('password')
    expect(toggle().attributes('aria-label')).toBe('Mostrar contraseña')
    await toggle().trigger('click')
    expect(wrapper.get('#password').attributes('type')).toBe('text')
    expect(toggle().attributes('aria-label')).toBe('Ocultar contraseña')
  })

  it('stores the session only for this tab when "Recordar mi cuenta" is unchecked', async () => {
    localStorage.clear()
    auth.signInWithPassword.mockResolvedValue(null)
    wrapper = mountForm('sign-in')
    await wrapper.get('input[type="checkbox"]').setValue(false)
    await type('email', 'ada@example.com'); await type('password', 'Secreta123')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(localStorage.getItem('sportleagues.remember-session')).toBe('false')
    localStorage.clear()
  })

  it('the create-account card switches to the sign-up form', async () => {
    wrapper = mountForm('sign-in')
    await wrapper.findAll('button').find((b) => b.text() === 'Crear cuenta')!.trigger('click')
    expect(wrapper.get('h2').text()).toBe('Crea tu cuenta')
    expect(wrapper.find('#full-name').exists()).toBe(true)
  })
})

describe('AuthForm — sign-up', () => {
  const fill = async (overrides: Partial<Record<string, string>> = {}) => {
    const values = { 'full-name': 'Ada Lovelace', email: 'ada@example.com', password: 'Secreta123', 'confirm-password': 'Secreta123', ...overrides }
    for (const [id, value] of Object.entries(values)) await type(id, value)
  }

  it('requires the full name', async () => {
    wrapper = mountForm('sign-up')
    await fill({ 'full-name': '' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signUpWithPassword).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Ingresa tu nombre completo')
  })

  it('rejects mismatching passwords and weak passwords', async () => {
    wrapper = mountForm('sign-up')
    await fill({ 'confirm-password': 'Otra12345' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('Las contraseñas no coinciden.')
    await fill({ password: 'corta', 'confirm-password': 'corta' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('al menos 8 caracteres')
    expect(auth.signUpWithPassword).not.toHaveBeenCalled()
  })

  it('registers and shows the email-confirmation notice', async () => {
    auth.signUpWithPassword.mockResolvedValue({ error: null, notice: 'Revisa tu correo para confirmar.', signedIn: false })
    wrapper = mountForm('sign-up')
    await fill()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.signUpWithPassword).toHaveBeenCalledWith({ fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'Secreta123' })
    expect(wrapper.get('[role="status"]').text()).toContain('Revisa tu correo')
    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('')
    expect(continueAfterSignIn).not.toHaveBeenCalled()
  })

  it('continues straight away when Supabase returns a session', async () => {
    auth.signUpWithPassword.mockResolvedValue({ error: null, notice: null, signedIn: true })
    wrapper = mountForm('sign-up')
    await fill()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(continueAfterSignIn).toHaveBeenCalledOnce()
  })
})

describe('AuthForm — password recovery', () => {
  it('asks only for the email and shows the neutral notice', async () => {
    auth.requestPasswordReset.mockResolvedValue({ error: null, notice: 'Si existe una cuenta con ese correo, te enviamos un enlace.' })
    wrapper = mountForm('forgot')
    expect(wrapper.find('#password').exists()).toBe(false)
    await type('email', 'ada@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('ada@example.com')
    expect(wrapper.get('[role="status"]').text()).toContain('Si existe una cuenta')
  })

  it('switches between modes and drops typed passwords', async () => {
    wrapper = mountForm('sign-in')
    await type('password', 'Secreta123')
    await wrapper.findAll('button').find((b) => b.text().includes('Olvidaste'))!.trigger('click')
    expect(wrapper.text()).toContain('Recupera tu contraseña')
    await wrapper.findAll('button').find((b) => b.text().includes('Volver a iniciar sesión'))!.trigger('click')
    expect((wrapper.get('#password').element as HTMLInputElement).value).toBe('')
  })
})
