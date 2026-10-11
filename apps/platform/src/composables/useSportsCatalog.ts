import { computed, ref } from 'vue'
import { isPreviewDataEnabled } from '../lib/preview-mode'
import { EMPTY_CATALOG, type Competition, type SportsCatalog, type Team } from '../lib/sports-catalog'

// Única puerta de entrada al catálogo deportivo para las pantallas. Hoy solo existe la fuente de
// vista previa; cuando Fase 06 publique tournaments/teams/matches, este composable cambiará de
// fuente (ver lib/sports-source.ts) sin que las vistas dependan de dónde vienen los datos.
let previewEnabled = isPreviewDataEnabled()
const now = ref(new Date())
const catalog = ref<SportsCatalog>(EMPTY_CATALOG)
const status = ref<'loading' | 'ready' | 'error'>(previewEnabled ? 'loading' : 'ready')
let started = false

async function loadCatalog(): Promise<void> {
  if (started) return
  started = true
  if (!previewEnabled) return
  try {
    // La condición usa constantes de build de Vite (no una función) para que, en un build sin
    // vista previa, el bundler elimine esta rama y el dataset de ejemplo no se incluya en el
    // JavaScript de QA/producción. `npm run verify:bundle` lo comprueba.
    if (import.meta.env.DEV || import.meta.env.VITE_PREVIEW_DATA === 'true') {
      // Fase 06 (cuando se autorice): sustituir por createSupabaseSportsSource(getSupabaseClient())
      // de lib/sports-source.ts. Las vistas no cambian porque solo ven este composable.
      const { createPreviewSource } = await import('../lib/sports-preview')
      catalog.value = (await createPreviewSource(now.value).load()).catalog
    }
    status.value = 'ready'
  } catch {
    status.value = 'error'
  }
}

export function resetSportsCatalogForTests(): void {
  previewEnabled = isPreviewDataEnabled()
  started = false
  catalog.value = EMPTY_CATALOG
  status.value = previewEnabled ? 'loading' : 'ready'
}

export function useSportsCatalog() {
  void loadCatalog()

  const competitionsById = computed(() => new Map(catalog.value.competitions.map((competition) => [competition.id, competition])))
  const teamsById = computed(() => new Map(catalog.value.teams.map((team) => [team.id, team])))

  function competition(id: string | null | undefined): Competition | undefined {
    return id ? competitionsById.value.get(id) : undefined
  }

  function team(id: string | null | undefined): Team | undefined {
    return id ? teamsById.value.get(id) : undefined
  }

  function teamName(id: string): string {
    return teamsById.value.get(id)?.name ?? id
  }

  function retry(): void {
    started = false
    status.value = previewEnabled ? 'loading' : 'ready'
    void loadCatalog()
  }

  return {
    preview: previewEnabled,
    now,
    catalog,
    loading: computed(() => status.value === 'loading'),
    failed: computed(() => status.value === 'error'),
    retry,
    competition,
    team,
    teamName,
  }
}
