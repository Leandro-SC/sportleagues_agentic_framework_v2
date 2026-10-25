import { ref } from 'vue'
import { getSupabaseClient } from '../lib/supabase'

// Eliminación de la propia cuenta (ADR-026). El servidor decide: la Edge Function verifica el JWT, anonimiza en SQL y borra la
// identidad de Auth. La UI solo consulta impedimentos para explicarlos antes de confirmar.
export const DELETE_CONFIRMATION = 'ELIMINAR'

const BLOCKER_COPY: Record<string, string> = {
  ADMINISTERS_ORGANIZATION: 'Administras una organización: transfiere su administración antes de eliminar tu cuenta.',
  ADMINISTERS_POOL: 'Eres parte del equipo de una quiniela: pide que te retiren de ese rol antes de eliminar tu cuenta.',
}

export function blockerMessages(codes: readonly string[]): string[] {
  return codes.map((code) => BLOCKER_COPY[code] ?? 'Tu cuenta tiene un rol administrativo activo.')
}

type Client = ReturnType<typeof getSupabaseClient>

export function useAccountDeletion(clientFactory: () => Client = getSupabaseClient) {
  const blockers = ref<string[] | null>(null)
  const deleting = ref(false)
  const error = ref('')

  async function loadBlockers(): Promise<void> {
    error.value = ''
    const { data, error: rpcError } = await clientFactory().rpc('account_deletion_blockers')
    blockers.value = rpcError ? null : ((data ?? []) as string[])
    if (rpcError) error.value = 'No pudimos comprobar si tu cuenta se puede eliminar. Inténtalo de nuevo.'
  }

  /** true si la cuenta quedó eliminada. La sesión local debe cerrarse después (la del servidor ya fue revocada). */
  async function deleteAccount(confirmation: string): Promise<boolean> {
    error.value = ''
    if (confirmation.trim() !== DELETE_CONFIRMATION) { error.value = `Escribe ${DELETE_CONFIRMATION} para confirmar.`; return false }
    deleting.value = true
    try {
      const { data, error: fnError } = await clientFactory().functions.invoke('delete-account', { body: { confirm: DELETE_CONFIRMATION } })
      if (!fnError && (data as { code?: string } | null)?.code === 'DELETED') return true
      let payload: { code?: string; blockers?: string[] } | null = null
      try { payload = await (fnError as { context?: Response } | null)?.context?.json() ?? null } catch { payload = null }
      if (payload?.code === 'HAS_ADMIN_ROLES') {
        blockers.value = payload.blockers ?? []
        error.value = blockerMessages(blockers.value)[0] ?? 'Tu cuenta tiene un rol administrativo activo.'
      } else {
        error.value = 'No pudimos eliminar tu cuenta. Inténtalo de nuevo en unos minutos.'
      }
      return false
    } finally {
      deleting.value = false
    }
  }

  return { blockers, deleting, error, loadBlockers, deleteAccount }
}
