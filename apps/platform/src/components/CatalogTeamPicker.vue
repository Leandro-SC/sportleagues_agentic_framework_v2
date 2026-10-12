<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CloudOff, LoaderCircle } from 'lucide-vue-next'
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import PrimaryButton from './PrimaryButton.vue'
import SearchField from './SearchField.vue'
import SecondaryButton from './SecondaryButton.vue'
import SegmentedTabs from './SegmentedTabs.vue'
import TeamBadge from './TeamBadge.vue'
import { useCatalog } from '../composables/useCatalog'
import { countryName, normalizeSearch, searchCompetitions, searchTeams, type CatalogTeam } from '../lib/catalog-local'

// Selector de equipos/selecciones del catálogo global compartido (ADR-016). Búsqueda local-first: instantánea, paginada y operativa sin
// conexión. Incorporar equipos al torneo es una acción del servidor (RPC `import_catalog_teams`); aquí solo se eligen.
const props = defineProps<{ enrolledNames: string[]; importing: boolean }>()
const emit = defineEmits<{ import: [teamIds: string[]] }>()

const PAGE_SIZE = 30
const catalog = useCatalog()
const query = ref('')
const kind = ref<'all' | 'club' | 'national'>('all')
const country = ref('')
const competitionId = ref('')
const page = ref(0)
const selected = ref<Set<string>>(new Set())

const kinds = [{ value: 'all' as const, label: 'Todos' }, { value: 'club' as const, label: 'Clubes' }, { value: 'national' as const, label: 'Selecciones' }]
const filters = computed(() => ({ query: query.value, kind: kind.value, country: country.value, competitionId: competitionId.value }))
const result = computed(() => searchTeams(catalog.snapshot.value, filters.value, 0, (page.value + 1) * PAGE_SIZE))
const competitions = computed(() => searchCompetitions(catalog.snapshot.value, ''))
const countries = computed(() => {
  const codes = new Set(catalog.snapshot.value.teams.map((team) => team.country_code).filter((code): code is string => Boolean(code)))
  return [...codes].map((code) => ({ code, name: countryName(catalog.snapshot.value, code) })).sort((a, b) => a.name.localeCompare(b.name, 'es'))
})
const enrolled = computed(() => new Set(props.enrolledNames.map((name) => normalizeSearch(name))))
const isEnrolled = (team: CatalogTeam): boolean => enrolled.value.has(normalizeSearch(team.name))
const allMatching = computed(() => searchTeams(catalog.snapshot.value, filters.value, 0, 100_000).items.filter((team) => !isEnrolled(team)))
const updatedLabel = computed(() => {
  if (!catalog.updatedAt.value) return ''
  const minutes = Math.max(0, Math.round((Date.now() - catalog.updatedAt.value) / 60000))
  const age = minutes < 1 ? 'ahora' : minutes < 60 ? `hace ${minutes} min` : minutes < 2880 ? `hace ${Math.round(minutes / 60)} h` : `hace ${Math.round(minutes / 1440)} días`
  return `Catálogo actualizado ${age}`
})

watch(filters, () => { page.value = 0 })

function toggle(team: CatalogTeam): void {
  if (isEnrolled(team)) return
  const next = new Set(selected.value)
  if (next.has(team.id)) next.delete(team.id); else next.add(team.id)
  selected.value = next
}
function selectAllMatching(): void { selected.value = new Set([...selected.value, ...allMatching.value.map((team) => team.id)]) }
function submit(): void {
  if (!selected.value.size) return
  emit('import', [...selected.value])
  selected.value = new Set()
}
onMounted(() => { void catalog.ensureLoaded() })
</script>

<template>
  <section class="space-y-3" aria-label="Catálogo de equipos y selecciones">
    <div>
      <h3 class="font-display font-bold text-text">Catálogo compartido</h3>
      <p class="text-sm text-text-muted">Elige clubes o selecciones ya registrados y añádelos a tu torneo sin escribirlos de nuevo.</p>
    </div>

    <div v-if="catalog.loading.value" class="flex items-center justify-center py-8 text-sm text-text-muted" role="status"><LoaderCircle class="mr-2 h-4 w-4 animate-spin" />Cargando catálogo…</div>
    <div v-else-if="catalog.failed.value" class="space-y-3">
      <ErrorState description="No pudimos cargar el catálogo. Puedes añadir equipos manualmente más abajo." />
      <SecondaryButton @click="catalog.reload()">Reintentar</SecondaryButton>
    </div>

    <template v-else>
      <SearchField id="catalog-search" v-model="query" label="Buscar equipo, país o competición" placeholder="Equipo, país o competición…" />
      <SegmentedTabs v-model="kind" :options="kinds" label="Tipo de equipo" variant="pill" />
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm font-medium text-text-muted">País
          <select v-model="country" class="field-surface mt-1.5 w-full px-3 py-3 text-sm"><option value="">Todos</option><option v-for="item in countries" :key="item.code" :value="item.code">{{ item.name }}</option></select>
        </label>
        <label class="block text-sm font-medium text-text-muted">Competición
          <select v-model="competitionId" class="field-surface mt-1.5 w-full px-3 py-3 text-sm"><option value="">Todas</option><option v-for="item in competitions" :key="item.id" :value="item.id">{{ item.name }}</option></select>
        </label>
      </div>

      <p class="flex items-center gap-1.5 text-xs text-text-faint" role="status">
        <CloudOff v-if="catalog.offline.value" class="h-3.5 w-3.5 text-warn" aria-hidden="true" />
        <span>{{ catalog.offline.value ? 'Sin conexión · ' : '' }}{{ updatedLabel }}</span>
      </p>

      <EmptyState v-if="!result.total" title="Sin resultados" description="Prueba con otro nombre o quita filtros. Si el equipo no existe, añádelo manualmente más abajo." />
      <template v-else>
        <p class="text-sm text-text-muted" aria-live="polite">{{ result.total }} resultado(s)</p>
        <ul class="divide-y divide-border rounded-xl border border-border" data-test="catalog-results">
          <li v-for="team in result.items" :key="team.id">
            <label class="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-2" :class="isEnrolled(team) ? 'opacity-60' : ''">
              <input type="checkbox" class="h-4 w-4 rounded accent-primary" :checked="selected.has(team.id)" :disabled="isEnrolled(team)" @change="toggle(team)" />
              <TeamBadge :name="team.name" :kind="team.kind" :country-code="team.country_code" size="sm" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold text-text">{{ team.name }}</span>
                <span class="block truncate text-xs text-text-muted">{{ team.kind === 'national' ? 'Selección' : 'Club' }} · {{ countryName(catalog.snapshot.value, team.country_code) }}</span>
              </span>
              <span v-if="isEnrolled(team)" class="text-xs font-semibold text-primary">En tu torneo</span>
            </label>
          </li>
        </ul>
        <SecondaryButton v-if="result.hasMore" @click="page += 1">Mostrar más</SecondaryButton>
        <div class="flex flex-wrap gap-2">
          <SecondaryButton v-if="allMatching.length" :full-width="false" @click="selectAllMatching">Seleccionar los {{ allMatching.length }} filtrados</SecondaryButton>
          <PrimaryButton :full-width="false" :disabled="!selected.size" :loading="importing" @click="submit">Incorporar {{ selected.size || '' }} al torneo</PrimaryButton>
        </div>
      </template>
      <p class="text-xs text-text-faint">Datos abiertos de Wikidata (CC0). La pertenencia a ligas puede no ser la de la temporada vigente: verifica tus participantes. Los clubes usan escudo generado; las selecciones, su bandera.</p>
    </template>
  </section>
</template>
