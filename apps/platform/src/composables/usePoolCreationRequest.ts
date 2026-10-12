import { computed, ref } from 'vue'
import {
  classifyPoolCreationError, extractRetryAfter, humanizePoolCreationError, normalizePoolRequestNote, parsePoolCreationRequest,
  type PoolCreationErrorKind, type PoolCreationRequest, type RpcFailure,
} from '../lib/pool-creation-request'
import { getSupabaseClient } from '../lib/supabase'

// Consume el contrato RPC de ADR-017. No hay ninguna llamada que reciba tenant_id, rol o estado: el
// único parámetro de cliente es `p_note`. El servidor decide idempotencia, validez y permisos.
export type PoolCreationRpcResult = { data: unknown; error: RpcFailure | null }
export type PoolCreationRequestClient = {
  rpc: (fn: 'request_pool_creation' | 'my_pool_creation_request' | 'cancel_pool_creation_request', args?: { p_note: string | null }) => PromiseLike<PoolCreationRpcResult>
}
type ClientFactory = () => PoolCreationRequestClient
const defaultClientFactory: ClientFactory = () => getSupabaseClient() as unknown as PoolCreationRequestClient

export type Availability = 'unknown' | 'available' | 'unavailable'

export function usePoolCreationRequest(clientFactory: ClientFactory = defaultClientFactory) {
  const request = ref<PoolCreationRequest | null>(null)
  const loading = ref(false)
  const submitting = ref(false)
  const cancelling = ref(false)
  const availability = ref<Availability>('unknown')
  // 'unavailable' = RPC inexistente; 'network' = sin conexión. Ambos degradan la función sin romper la pantalla.
  const unavailableReason = ref<'unavailable' | 'network' | null>(null)
  const alreadyOrganizer = ref(false)
  // Fin del enfriamiento tras un rechazo reciente (informativo; el servidor decide).
  const cooldownUntil = ref<string | null>(null)
  const error = ref('')
  const notice = ref('')

  const hasPending = computed(() => request.value?.status === 'pending')
  const coolingDown = computed(() => Boolean(cooldownUntil.value) && Date.parse(cooldownUntil.value as string) > Date.now())
  const isBusy = computed(() => loading.value || submitting.value || cancelling.value)
  // Se puede enviar solo con la función disponible y sin una solicitud viva (pendiente) ni aprobada.
  const canSubmit = computed(() => availability.value === 'available' && !isBusy.value && !alreadyOrganizer.value && request.value?.status !== 'pending' && request.value?.status !== 'approved' && !coolingDown.value)

  function degrade(kind: PoolCreationErrorKind): boolean {
    if (kind === 'unavailable' || kind === 'network') {
      availability.value = 'unavailable'
      unavailableReason.value = kind
      error.value = ''
      return true
    }
    return false
  }

  async function call(fn: Parameters<PoolCreationRequestClient['rpc']>[0], args?: { p_note: string | null }): Promise<{ data: unknown; kind: PoolCreationErrorKind | null; retryAfter?: string | null }> {
    try {
      const { data, error: rpcError } = await clientFactory().rpc(fn, args)
      if (rpcError) return { data: null, kind: classifyPoolCreationError(rpcError), retryAfter: extractRetryAfter(rpcError) }
      return { data, kind: null }
    } catch {
      // supabase-js solo lanza ante fallos de transporte; el servidor responde con `error`.
      return { data: null, kind: 'network' }
    }
  }

  async function load(): Promise<void> {
    loading.value = true; error.value = ''
    const { data, kind } = await call('my_pool_creation_request')
    loading.value = false
    if (kind) {
      if (!degrade(kind)) { availability.value = 'available'; error.value = humanizePoolCreationError(kind) }
      return
    }
    availability.value = 'available'; unavailableReason.value = null
    request.value = parsePoolCreationRequest(data)
  }

  // Devuelve true si el servidor aceptó (o ya tenía) una solicitud pendiente.
  async function submit(rawNote: string): Promise<boolean> {
    error.value = ''; notice.value = ''
    if (!canSubmit.value) return false
    const { note, error: noteError } = normalizePoolRequestNote(rawNote)
    if (noteError) { error.value = noteError; return false }
    submitting.value = true
    const { data, kind, retryAfter } = await call('request_pool_creation', { p_note: note })
    submitting.value = false
    if (kind) {
      if (kind === 'already_organizer') alreadyOrganizer.value = true
      if (kind === 'cooldown_active') cooldownUntil.value = retryAfter ?? null
      if (!degrade(kind)) error.value = humanizePoolCreationError(kind, retryAfter)
      return false
    }
    const parsed = parsePoolCreationRequest(data)
    if (!parsed) { error.value = humanizePoolCreationError('unknown'); return false }
    request.value = parsed
    notice.value = parsed.created === false ? 'Ya tenías una solicitud pendiente; no se creó otra.' : 'Solicitud enviada.'
    return parsed.status === 'pending'
  }

  async function cancel(): Promise<boolean> {
    error.value = ''; notice.value = ''
    if (!hasPending.value || isBusy.value) return false
    cancelling.value = true
    const { data, kind } = await call('cancel_pool_creation_request')
    cancelling.value = false
    if (kind) {
      if (kind === 'no_pending_request') { await load(); notice.value = humanizePoolCreationError(kind); return false }
      if (!degrade(kind)) error.value = humanizePoolCreationError(kind)
      return false
    }
    const parsed = parsePoolCreationRequest(data)
    if (!parsed) { error.value = humanizePoolCreationError('unknown'); return false }
    request.value = parsed
    notice.value = 'Solicitud cancelada.'
    return true
  }

  return { request, loading, submitting, cancelling, availability, unavailableReason, alreadyOrganizer, cooldownUntil, error, notice, hasPending, canSubmit, load, submit, cancel }
}
