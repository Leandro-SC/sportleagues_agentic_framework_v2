import { ref } from 'vue'
import { clearJoinIntent, peekJoinIntent } from '../lib/join-intent'
import { requestJoinPool, type JoinResult } from '../lib/join-rpc'
import { getSupabaseClient } from '../lib/supabase'

export type { JoinResult } from '../lib/join-rpc'

export function useJoinPool() {
  const loading = ref(false)
  const error = ref('')
  const transientFailure = ref(false)
  const sessionExpired = ref(false)

  async function join(code: string): Promise<JoinResult | null> {
    loading.value = true; error.value = ''; transientFailure.value = false; sessionExpired.value = false
    const { data, error: rpcError, transient, sessionExpired: expired } = await requestJoinPool(getSupabaseClient(), code)
    loading.value = false
    transientFailure.value = Boolean(transient)
    sessionExpired.value = Boolean(expired)
    // `requestJoinPool` ya devuelve mensajes amigables: aquí nunca se muestra texto crudo del servidor.
    if (rpcError || !data) { error.value = rpcError ?? 'No fue posible unirse a la quiniela. Inténtalo de nuevo.'; return null }
    return data
  }

  // La invitación se borra al unirse con éxito o cuando el servidor la rechaza (para no reintentar un
  // código inválido en bucle). Se conserva ante un fallo transitorio de red y ante una sesión vencida
  // (el código era válido: se pide volver a iniciar sesión y se reintenta después).
  async function resumeIntent(): Promise<JoinResult | null> {
    const code = peekJoinIntent()
    if (!code) return null
    const result = await join(code)
    if (result || (!transientFailure.value && !sessionExpired.value)) clearJoinIntent()
    return result
  }

  return { loading, error, transientFailure, sessionExpired, join, resumeIntent }
}
