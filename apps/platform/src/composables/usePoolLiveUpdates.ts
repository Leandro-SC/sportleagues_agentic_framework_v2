import { onBeforeUnmount, watch } from 'vue'
import { getSupabaseClient } from '../lib/supabase'

// Mantiene la tabla y la parrilla al día mientras la quiniela está abierta: cambios de `official_results` y `matches` del tenant por
// Realtime (respeta RLS) y, como respaldo, un sondeo cada 60 s solo mientras queden partidos sin resultado final y la pestaña esté
// visible. Varias señales seguidas se agrupan en una sola recarga.
type Client = ReturnType<typeof getSupabaseClient>

export const LIVE_POLL_MS = 60_000
export const LIVE_DEBOUNCE_MS = 1_500

export function usePoolLiveUpdates(options: {
  tenantId: () => string | null
  /** true mientras haya partidos pendientes o en juego: sin ellos no se sondea. */
  active: () => boolean
  onChange: () => void
  clientFactory?: () => Client
}) {
  const clientFactory = options.clientFactory ?? getSupabaseClient
  let stopChannel: (() => void) | null = null
  let debounce: ReturnType<typeof setTimeout> | undefined
  let poll: ReturnType<typeof setInterval> | undefined

  const trigger = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => { debounce = undefined; options.onChange() }, LIVE_DEBOUNCE_MS)
  }
  const visible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible'
  const onVisibility = (): void => { if (visible()) trigger() }

  function subscribe(tenantId: string | null): void {
    stopChannel?.(); stopChannel = null
    if (!tenantId) return
    try {
      const client = clientFactory()
      const filter = `tenant_id=eq.${tenantId}`
      const channel = client.channel(`pool-live:${tenantId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'official_results', filter }, trigger)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches', filter }, trigger)
        .subscribe()
      stopChannel = () => { void client.removeChannel(channel) }
    } catch {
      stopChannel = null   // sin Realtime: queda el sondeo
    }
  }

  watch(options.tenantId, subscribe, { immediate: true })
  poll = setInterval(() => { if (visible() && options.active()) options.onChange() }, LIVE_POLL_MS)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

  function stop(): void {
    stopChannel?.(); stopChannel = null
    if (debounce) clearTimeout(debounce)
    if (poll) clearInterval(poll)
    debounce = undefined; poll = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
  }
  onBeforeUnmount(stop)
  return { stop, trigger }
}
