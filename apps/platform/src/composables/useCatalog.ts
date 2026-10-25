import { computed, ref } from 'vue'
import { loadCatalog, EMPTY_SNAPSHOT, type CatalogClient, type CatalogSnapshot } from '../lib/catalog-local'
import { getSupabaseClient } from '../lib/supabase'

// Estado compartido del catálogo global para todas las pantallas: UNA carga/sincronización aunque lo pidan varios componentes
// (deduplicación), datos locales al instante, revalidación en segundo plano y estado de actualización visible (fresco/obsoleto/sin conexión).
const snapshot = ref<CatalogSnapshot>(EMPTY_SNAPSHOT)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const freshness = ref<'fresh' | 'revalidating' | 'offline' | 'network'>('network')
const updatedAt = ref<number | null>(null)
let inflight: Promise<void> | null = null

async function load(client: CatalogClient): Promise<void> {
  if (inflight) return inflight
  status.value = status.value === 'ready' ? 'ready' : 'loading'
  inflight = loadCatalog(client, {
    onUpdate: (update) => { snapshot.value = update.value; freshness.value = update.status; updatedAt.value = update.updatedAt; status.value = 'ready' },
  })
    .then((result) => { snapshot.value = result.value; freshness.value = result.status; updatedAt.value = result.updatedAt; status.value = 'ready' })
    .catch(() => { status.value = snapshot.value.teams.length ? 'ready' : 'error' })
    .finally(() => { inflight = null })
  return inflight
}

export function resetCatalogForTests(): void {
  snapshot.value = EMPTY_SNAPSHOT; status.value = 'idle'; freshness.value = 'network'; updatedAt.value = null; inflight = null
}

export function useCatalog(clientFactory: () => CatalogClient = () => getSupabaseClient() as unknown as CatalogClient) {
  function ensureLoaded(): Promise<void> {
    return status.value === 'ready' ? Promise.resolve() : load(clientFactory())
  }
  return {
    snapshot,
    status,
    freshness,
    updatedAt,
    loading: computed(() => status.value === 'loading'),
    failed: computed(() => status.value === 'error'),
    offline: computed(() => freshness.value === 'offline'),
    ensureLoaded,
    reload: () => { status.value = 'idle'; return load(clientFactory()) },
  }
}
