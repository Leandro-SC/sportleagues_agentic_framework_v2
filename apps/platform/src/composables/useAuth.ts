import type { Session, User } from '@supabase/supabase-js'
import { computed, reactive } from 'vue'
import { completeImplicitCallback, isRecoveryCallback } from '../lib/auth-callback'
import {
  PASSWORD_RESET_NOTICE,
  SIGN_UP_NOTICE,
  authErrorMessage,
  normalizeEmail,
  sanitizeFullName,
  validateNewPassword,
} from '../lib/auth-validation'
import { clearJoinIntent } from '../lib/join-intent'
import { getSupabaseClient } from '../lib/supabase'

type Profile = { id: string; display_name: string }

// Se evalúa al cargar el módulo, antes de que supabase-js procese y limpie el hash del enlace:
// el callback de recuperación de contraseña aterriza en /auth/callback#...&type=recovery.
const landedAsRecovery = typeof window !== 'undefined' && window.location.pathname === '/auth/callback' && isRecoveryCallback(window.location.href)

const state = reactive({
  session: null as Session | null,
  user: null as User | null,
  profile: null as Profile | null,
  loading: true,
  error: '',
  recovery: landedAsRecovery,
})
let subscribed = false
// Un solo intento automático de crear el perfil por usuario y carga de página: si falla, el guard
// envía a /onboarding (reintento manual) en lugar de repetir escrituras en cada evento de Auth.
let ensureAttemptedFor: string | null = null
let restoreInFlight: Promise<void> | null = null

const PROFILE_ERROR = 'No pudimos guardar tu perfil. Inténtalo de nuevo.'

async function loadProfile(): Promise<void> {
  if (!state.user) { state.profile = null; return }
  const { data, error } = await getSupabaseClient().from('profiles').select('id, display_name').eq('id', state.user.id).maybeSingle()
  if (error) { state.error = PROFILE_ERROR; return }
  state.profile = data
}

/**
 * Crea el perfil la primera vez que hay sesión usando el nombre que el proveedor o el registro
 * dejaron en user_metadata. Es solo un nombre para mostrar (validado igual que en onboarding), sin
 * ningún efecto de autorización. `ignoreDuplicates` => ON CONFLICT DO NOTHING: nunca pisa un
 * perfil existente ni requiere una policy de UPDATE.
 */
async function ensureProfile(): Promise<void> {
  if (!state.user || state.profile || ensureAttemptedFor === state.user.id) return
  ensureAttemptedFor = state.user.id
  const meta = state.user.user_metadata ?? {}
  const name = sanitizeFullName(meta.full_name) ?? sanitizeFullName(meta.name)
  if (!name) return
  const { error } = await getSupabaseClient().from('profiles').upsert({ id: state.user.id, display_name: name }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) { state.error = PROFILE_ERROR; return }
  await loadProfile()
}

async function syncProfile(): Promise<void> {
  await loadProfile()
  await ensureProfile()
}

export function useAuth() {
  const client = getSupabaseClient()

  async function restore(): Promise<void> {
    if (restoreInFlight) return restoreInFlight
    restoreInFlight = (async () => {
      state.loading = true
      if (!subscribed) {
        subscribed = true
        client.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') state.recovery = true
          state.session = session
          state.user = session?.user ?? null
          // Sin await dentro del callback: supabase-js documenta que bloquearlo puede interbloquear el cliente.
          void syncProfile()
        })
      }
      const { data, error } = await client.auth.getSession()
      if (error) state.error = error.message
      state.session = data.session
      state.user = data.session?.user ?? null
      await syncProfile()
      state.loading = false
    })().finally(() => { restoreInFlight = null })
    return restoreInFlight
  }

  /** Registro con correo y contraseña. Devuelve el error o `notice` (mensaje genérico anti-enumeración). */
  async function signUpWithPassword(input: { fullName: string; email: string; password: string }): Promise<{ error: string | null; notice: string | null; signedIn: boolean }> {
    const fullName = sanitizeFullName(input.fullName)
    if (!fullName) return { error: 'Ingresa tu nombre completo.', notice: null, signedIn: false }
    const { data, error } = await client.auth.signUp({
      email: normalizeEmail(input.email),
      password: input.password,
      options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) return { error: authErrorMessage(error), notice: null, signedIn: false }
    // Con confirmación de correo activa no hay sesión hasta que el usuario confirma.
    if (data.session) return { error: null, notice: null, signedIn: true }
    return { error: null, notice: SIGN_UP_NOTICE, signedIn: false }
  }

  async function signInWithPassword(email: string, password: string): Promise<string | null> {
    const { error } = await client.auth.signInWithPassword({ email: normalizeEmail(email), password })
    if (error) return authErrorMessage(error)
    state.recovery = false
    await restore()
    return null
  }

  async function requestPasswordReset(email: string): Promise<{ error: string | null; notice: string }> {
    const { error } = await client.auth.resetPasswordForEmail(normalizeEmail(email), { redirectTo: `${window.location.origin}/auth/callback` })
    // Solo se informan fallos de infraestructura/límite; "no existe la cuenta" nunca se revela.
    if (error && (error.status === 429 || /rate_limit/.test(error.code ?? ''))) return { error: authErrorMessage(error), notice: '' }
    return { error: null, notice: PASSWORD_RESET_NOTICE }
  }

  async function updatePassword(password: string): Promise<string | null> {
    if (!state.session) return 'El enlace expiró. Solicita uno nuevo desde "Olvidé mi contraseña".'
    const invalid = validateNewPassword(password)
    if (invalid) return invalid
    const { error } = await client.auth.updateUser({ password })
    if (error) return authErrorMessage(error)
    state.recovery = false
    return null
  }

  /** Descarta el modo recuperación (p. ej. el usuario cancela la pantalla de nueva contraseña). */
  function clearRecovery(): void { state.recovery = false }

  async function signInWithGoogle(): Promise<string | null> {
    state.recovery = false
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
    return error ? authErrorMessage(error) : null
  }

  async function completeCallback(): Promise<string | null> {
    return completeImplicitCallback(window.location.href, async () => {
      await restore()
      return Boolean(state.session)
    })
  }

  async function saveProfile(displayName: string): Promise<string | null> {
    const name = sanitizeFullName(displayName)
    if (!state.user) return 'Debes iniciar sesión para completar tu perfil.'
    if (!name) return 'Ingresa un nombre de 1 a 80 caracteres.'
    const { error } = await client.from('profiles').upsert({ id: state.user.id, display_name: name })
    if (error) return PROFILE_ERROR
    await loadProfile()
    return null
  }

  async function signOut(): Promise<string | null> {
    const { error } = await client.auth.signOut()
    if (!error) { state.session = null; state.user = null; state.profile = null; state.recovery = false; ensureAttemptedFor = null; clearJoinIntent() }
    return error?.message ?? null
  }

  return {
    state,
    isAuthenticated: computed(() => Boolean(state.user)),
    restore,
    signUpWithPassword,
    signInWithPassword,
    requestPasswordReset,
    updatePassword,
    clearRecovery,
    signInWithGoogle,
    completeCallback,
    saveProfile,
    signOut,
  }
}
