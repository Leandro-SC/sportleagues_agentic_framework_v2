import { ref } from 'vue'
import { takeJoinIntent } from '../lib/join-intent'
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

  async function join(code: string): Promise<JoinResult | null> {
    loading.value = true; error.value = ''
    const { data, error: rpcError } = await requestJoinPool(getSupabaseClient(), code)
    loading.value = false
    if (rpcError || !data) { error.value = messageFor(rpcError ?? 'No fue posible unirse a la quiniela.'); return null }
    return data
  }

  async function resumeIntent(): Promise<JoinResult | null> {
    const code = takeJoinIntent()
    return code ? join(code) : null
  }

  return { loading, error, join, resumeIntent }
}
