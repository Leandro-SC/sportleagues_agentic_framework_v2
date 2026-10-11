import { ref } from 'vue'
import { clearJoinIntent, peekJoinIntent } from '../lib/join-intent'
import { requestJoinPool, type JoinResult } from '../lib/join-rpc'
import { getSupabaseClient } from '../lib/supabase'

export type { JoinResult } from '../lib/join-rpc'

function messageFor(error: string): string {
  if (/invalid|expired|open/i.test(error)) return 'El código no es válido, expiró o la quiniela no está disponible.'
  if (/authentication|required|permission|unauthorized/i.test(error)) return 'No tienes autorización para unirte a esta quiniela.'
  return error
}

export function useJoinPool() {
  const loading = ref(false)
  const error = ref('')
  const transientFailure = ref(false)

  async function join(code: string): Promise<JoinResult | null> {
    loading.value = true; error.value = ''; transientFailure.value = false
    const { data, error: rpcError, transient } = await requestJoinPool(getSupabaseClient(), code)
    loading.value = false
    transientFailure.value = Boolean(transient)
    if (rpcError || !data) { error.value = messageFor(rpcError ?? 'No fue posible unirse a la quiniela.'); return null }
    return data
  }

  // La invitación se borra al unirse con éxito o cuando el servidor la rechaza (para no reintentar un
  // código inválido en bucle). Ante un fallo transitorio de red se conserva para reintentarla.
  async function resumeIntent(): Promise<JoinResult | null> {
    const code = peekJoinIntent()
    if (!code) return null
    const result = await join(code)
    if (result || !transientFailure.value) clearJoinIntent()
    return result
  }

  return { loading, error, transientFailure, join, resumeIntent }
}
