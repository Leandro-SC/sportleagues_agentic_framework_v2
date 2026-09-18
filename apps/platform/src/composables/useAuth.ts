import type { Session, User } from '@supabase/supabase-js'
import { computed, reactive } from 'vue'
import { completeImplicitCallback } from '../lib/auth-callback'
import { clearJoinIntent } from '../lib/join-intent'
import { getSupabaseClient } from '../lib/supabase'

type Profile = { id: string; display_name: string }
const state = reactive({ session: null as Session | null, user: null as User | null, profile: null as Profile | null, loading: true, error: '' })
let subscribed = false
let restoreInFlight: Promise<void> | null = null

async function loadProfile(): Promise<void> {
  if (!state.user) { state.profile = null; return }
  const { data, error } = await getSupabaseClient().from('profiles').select('id, display_name').eq('id', state.user.id).maybeSingle()
  if (error) { state.error = error.message; return }
  state.profile = data
}

export function useAuth() {
  const client = getSupabaseClient()

  async function restore(): Promise<void> {
    if (restoreInFlight) return restoreInFlight
    restoreInFlight = (async () => {
      state.loading = true
      if (!subscribed) {
        subscribed = true
        client.auth.onAuthStateChange((_event, session) => {
          state.session = session
          state.user = session?.user ?? null
          void loadProfile()
        })
      }
      const { data, error } = await client.auth.getSession()
      if (error) state.error = error.message
      state.session = data.session
      state.user = data.session?.user ?? null
      await loadProfile()
      state.loading = false
    })().finally(() => { restoreInFlight = null })
    return restoreInFlight
  }

  async function sendMagicLink(email: string): Promise<string | null> {
    const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
    return error?.message ?? null
  }

  async function signInWithGoogle(): Promise<string | null> {
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
    return error?.message ?? null
  }

  async function completeCallback(): Promise<string | null> {
    return completeImplicitCallback(window.location.href, async () => {
      await restore()
      return Boolean(state.session)
    })
  }

  async function saveProfile(displayName: string): Promise<string | null> {
    const name = displayName.trim()
    if (!state.user) return 'Debes iniciar sesión para completar tu perfil.'
    if (!name || name.length > 80) return 'Ingresa un nombre de 1 a 80 caracteres.'
    const { error } = await client.from('profiles').upsert({ id: state.user.id, display_name: name })
    if (!error) await loadProfile()
    return error?.message ?? null
  }

  async function signOut(): Promise<string | null> {
    const { error } = await client.auth.signOut()
    if (!error) { state.session = null; state.user = null; state.profile = null; clearJoinIntent() }
    return error?.message ?? null
  }

  return { state, isAuthenticated: computed(() => Boolean(state.user)), restore, sendMagicLink, signInWithGoogle, completeCallback, saveProfile, signOut }
}
