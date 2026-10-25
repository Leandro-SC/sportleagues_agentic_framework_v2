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
import { getOfflineCache, purgePrivateCaches } from '../lib/offline-cache'
import { getSupabaseClient } from '../lib/supabase'

type Profile = { id: string; display_name: string }

// Se evalúa al cargar el módulo, antes de que supabase-js procese y limpie el hash del enlace:
// el callback de recuperación de contraseña aterriza en /auth/callback#...&type=recovery.
const landedAsRecovery = typeof window !== 'undefined' && window.location.pathname === '/auth/callback' && isRecoveryCallback(window.location.href)

const state = reactive({
  session: null as Session | null,
  user: null as User | null,
  profile: null as Profile | null,
  // `true` significa que no se pudo comprobar el perfil (p. ej. sin red), no que no exista.
  // Evita que el router envíe erróneamente a onboarding a una cuenta ya configurada.
  profileLookupUnavailable: false,
  loading: true,
  error: '',
  recovery: landedAsRecovery,
  legalAccepted: null as boolean | null,
})
let subscribed = false
// Un solo intento automático de crear el perfil por usuario y carga de página: si falla, el guard
// envía a /onboarding (reintento manual) en lugar de repetir escrituras en cada evento de Auth.
let ensureAttemptedFor: string | null = null
let restoreInFlight: Promise<void> | null = null

const PROFILE_ERROR = 'No pudimos guardar tu perfil. Inténtalo de nuevo.'
const SIGN_OUT_NOTICE = 'Cerramos tu sesión en este dispositivo, pero no pudimos confirmarlo con el servidor. Si usas un equipo compartido, vuelve a intentarlo con conexión.'
let expiredPurged = false

async function loadProfile(): Promise<void> {
  if (!state.user) { state.profile = null; state.profileLookupUnavailable = false; return }
  const { data, error } = await getSupabaseClient().from('profiles').select('id, display_name').eq('id', state.user.id).maybeSingle()
  if (error) { state.profileLookupUnavailable = true; state.error = PROFILE_ERROR; return }
  state.profile = data
  state.profileLookupUnavailable = false
}

/**
 * Crea el perfil la primera vez que hay sesión usando el nombre que el proveedor o el registro
 * dejaron en user_metadata. Es solo un nombre para mostrar (validado igual que en onboarding), sin
 * ningún efecto de autorización. `ignoreDuplicates` => ON CONFLICT DO NOTHING: nunca pisa un
 * perfil existente ni requiere una policy de UPDATE.
 */
async function ensureProfile(): Promise<void> {
  if (!state.user || state.profile || state.profileLookupUnavailable || ensureAttemptedFor === state.user.id) return
  ensureAttemptedFor = state.user.id
  const meta = state.user.user_metadata ?? {}
  const name = sanitizeFullName(meta.full_name) ?? sanitizeFullName(meta.name)
  if (!name) return
  const { error } = await getSupabaseClient().from('profiles').upsert({ id: state.user.id, display_name: name }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) { state.error = PROFILE_ERROR; return }
  await loadProfile()
}

let cacheOwner: string | null = null
let onlineRetryInstalled = false

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
          // Datos privados cacheados: nunca sobreviven a un cierre de sesión ni se muestran a otra identidad.
          if (event === 'SIGNED_OUT') { cacheOwner = null; void purgePrivateCaches() }
          else if (session?.user && session.user.id !== cacheOwner) { void purgePrivateCaches(session.user.id); cacheOwner = session.user.id }
          state.session = session
          state.user = session?.user ?? null
          state.legalAccepted = session?.user ? null : false
          // Sin await dentro del callback: supabase-js documenta que bloquearlo puede interbloquear el cliente.
          void syncProfile()
        })
      }
      if (!onlineRetryInstalled && typeof window !== 'undefined') {
        onlineRetryInstalled = true
        window.addEventListener('online', () => { if (state.user) void syncProfile() })
      }
      // FE-10: las entradas vencidas solo se borraban al releerlas; una limpieza por arranque acota la retención real.
      if (!expiredPurged) { expiredPurged = true; void getOfflineCache().purgeExpired().catch(() => undefined) }
      const { data, error } = await client.auth.getSession()
      if (error) state.error = error.message
      state.session = data.session
      state.user = data.session?.user ?? null
      state.legalAccepted = data.session?.user ? null : false
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
    // Quien tuviera otra sesión abierta con la contraseña anterior (p. ej. un atacante) la pierde. Es un refuerzo: si falla,
    // el cambio de contraseña ya se hizo y no se bloquea ni se muestra error.
    try { await client.auth.signOut({ scope: 'others' }) } catch { /* no bloqueante */ }
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

  /** El servidor decide si ambas versiones legales vigentes fueron aceptadas. */
  async function ensureLegalAcceptance(): Promise<boolean> {
    if (!state.user) return false
    if (state.legalAccepted === true) return true
    const { data, error } = await client.rpc('legal_acceptance_status')
    state.legalAccepted = !error && data === true
    return state.legalAccepted
  }

  async function acceptLegalDocuments(termsVersion: string, privacyVersion: string): Promise<string | null> {
    const { data, error } = await client.rpc('accept_legal_documents', { p_terms_version: termsVersion, p_privacy_version: privacyVersion })
    if (error || data !== true) return 'No pudimos registrar tu aceptación. Revisa tu conexión e inténtalo nuevamente.'
    state.legalAccepted = true
    return null
  }

  /**
   * Cierra la sesión de ESTE dispositivo (`scope: 'local'`; el valor por defecto `global` revocaría también las sesiones del
   * ordenador, el móvil, etc.). El estado local, la invitación pendiente y la caché privada se limpian SIEMPRE, aunque el
   * servidor no responda (auth-js ya borra su copia local aunque falle la revocación). Devuelve un aviso amable si el
   * servidor no pudo confirmar la revocación; nunca el texto crudo del error.
   */
  async function signOut(): Promise<string | null> {
    let notice: string | null = null
    try {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error) notice = SIGN_OUT_NOTICE
    } catch {
      notice = SIGN_OUT_NOTICE
    } finally {
      state.session = null; state.user = null; state.profile = null; state.profileLookupUnavailable = false; state.recovery = false; state.legalAccepted = false
      ensureAttemptedFor = null; cacheOwner = null
      clearJoinIntent()
      void purgePrivateCaches()
    }
    return notice
  }

  /** «Cancelar» en la pantalla de nueva contraseña: la sesión de recuperación no debe quedar abierta ni persistida. */
  async function cancelRecovery(): Promise<void> {
    state.recovery = false
    await signOut()
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
    cancelRecovery,
    signInWithGoogle,
    completeCallback,
    saveProfile,
    ensureLegalAcceptance,
    acceptLegalDocuments,
    signOut,
  }
}
