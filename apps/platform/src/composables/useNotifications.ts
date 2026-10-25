import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getSupabaseClient } from '../lib/supabase'
import { useAuth } from './useAuth'

// Avisos de resultados (ADR-025). La base de datos los crea al publicar o corregir un resultado; aquí solo se leen (RLS: cada
// usuario ve los suyos), llegan en tiempo real cuando Realtime está disponible y, como respaldo, con un sondeo cada 2 minutos y al
// volver a la pestaña. Nunca se crean desde el cliente.
export type AppNotification = { id: string; pool_id: string; match_id: string; kind: 'result_published' | 'result_corrected'; title: string; body: string; created_at: string; read_at: string | null }

type Client = ReturnType<typeof getSupabaseClient>
const COLUMNS = 'id, pool_id, match_id, kind, title, body, created_at, read_at'
const LIMIT = 30
const POLL_MS = 120_000

export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(Math.round(seconds), 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour')
  return rtf.format(Math.round(seconds / 86_400), 'day')
}

export function useNotifications(clientFactory: () => Client = getSupabaseClient, auth = useAuth()) {
  const items = ref<AppNotification[]>([])
  const loading = ref(false)
  const error = ref('')
  const unread = computed(() => items.value.filter((item) => !item.read_at).length)
  let stopLive: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let currentUser: string | null = null

  async function refresh(): Promise<void> {
    if (!currentUser) return
    const user = currentUser
    loading.value = true
    try {
      const { data, error: readError } = await clientFactory().from('notifications').select(COLUMNS).order('created_at', { ascending: false }).limit(LIMIT)
      if (user !== currentUser) return
      if (readError) { error.value = 'No pudimos cargar tus notificaciones.'; return }
      error.value = ''
      items.value = (data ?? []) as AppNotification[]
    } catch {
      if (user === currentUser) error.value = 'No pudimos cargar tus notificaciones.'
    } finally {
      if (user === currentUser) loading.value = false
    }
  }

  function subscribe(user: string): void {
    try {
      const client = clientFactory()
      const channel = client.channel(`notifications:${user}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `profile_id=eq.${user}` }, (payload) => {
          const row = payload.new as AppNotification
          if (user !== currentUser || !row?.id || items.value.some((item) => item.id === row.id)) return
          items.value = [row, ...items.value].slice(0, LIMIT)
        })
        .subscribe()
      stopLive = () => { void client.removeChannel(channel) }
    } catch {
      stopLive = null   // sin Realtime: queda el sondeo
    }
  }

  const onVisible = (): void => { if (document.visibilityState === 'visible') void refresh() }

  function stop(): void {
    stopLive?.(); stopLive = null
    if (timer) clearInterval(timer)
    timer = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
  }

  function start(user: string | null): void {
    stop()
    currentUser = user
    items.value = []
    if (!user) return
    void refresh()
    subscribe(user)
    timer = setInterval(() => { void refresh() }, POLL_MS)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
  }

  async function markRead(ids?: string[]): Promise<void> {
    const targets = ids ?? items.value.filter((item) => !item.read_at).map((item) => item.id)
    if (!targets.length) return
    const stamp = new Date().toISOString()
    const previous = items.value
    items.value = items.value.map((item) => (targets.includes(item.id) && !item.read_at ? { ...item, read_at: stamp } : item))
    const { error: rpcError } = await clientFactory().rpc('mark_notifications_read', { p_ids: ids ?? null })
    if (rpcError) { items.value = previous; error.value = 'No pudimos marcar las notificaciones como leídas.' }
  }

  watch(() => auth.state.user?.id ?? null, (user) => start(user), { immediate: true })
  onBeforeUnmount(stop)

  return { items, unread, loading, error, refresh, markRead }
}
