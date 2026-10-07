import { computed, ref } from 'vue'
import { isPreviewDataEnabled } from '../lib/preview-mode'
import { EMPTY_CATALOG, type Competition, type SportsCatalog, type Team } from '../lib/sports-catalog'
import { buildPreviewCatalog } from '../lib/sports-preview'

// Única puerta de entrada al catálogo deportivo para las pantallas. Hoy solo existe la fuente de
// vista previa; cuando Fase 06 publique tournaments/teams/matches, este composable cambiará de
// fuente sin que las vistas dependan de dónde vienen los datos.
const previewEnabled = isPreviewDataEnabled()
const now = ref(new Date())
const catalog = ref<SportsCatalog>(previewEnabled ? buildPreviewCatalog(now.value) : EMPTY_CATALOG)

export function useSportsCatalog() {
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

  return { preview: previewEnabled, now, catalog, competition, team, teamName }
}
