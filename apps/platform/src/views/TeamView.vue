<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { BadgeInfo, CalendarX2, SearchX, Shirt, Star } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import CatalogBoundary from '../components/CatalogBoundary.vue'
import BottomSheet from '../components/BottomSheet.vue'
import CompetitionEmblem from '../components/CompetitionEmblem.vue'
import CountryFlag from '../components/CountryFlag.vue'
import EmptyState from '../components/EmptyState.vue'
import NotificationsButton from '../components/NotificationsButton.vue'
import PreviewBadge from '../components/PreviewBadge.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import SectionHeader from '../components/SectionHeader.vue'
import SegmentedTabs from '../components/SegmentedTabs.vue'
import TeamCrest from '../components/TeamCrest.vue'
import TeamMatchRow from '../components/TeamMatchRow.vue'
import { useAuth } from '../composables/useAuth'
import { useFollowedTeams } from '../composables/useFollowedTeams'
import { useRouteTab } from '../composables/useRouteTab'
import { useSportsCatalog } from '../composables/useSportsCatalog'
import { rankStandings, teamForm, teamMatches } from '../lib/sports-catalog'

const TABS = ['partidos', 'plantilla', 'estadisticas'] as const
type Tab = (typeof TABS)[number]

const route = useRoute()
const auth = useAuth()
const sports = useSportsCatalog()
const followed = useFollowedTeams(() => sports.catalog.value.followedTeamIds)
const tab = useRouteTab<Tab>(TABS, 'partidos')
const infoOpen = ref(false)

const tabOptions: Array<{ value: Tab; label: string }> = [
  { value: 'partidos', label: 'Partidos' },
  { value: 'plantilla', label: 'Plantilla' },
  { value: 'estadisticas', label: 'Estadísticas' },
]

const team = computed(() => sports.team(String(route.params.teamId ?? '')))
const competition = computed(() => sports.competition(team.value?.competition_id))
const standing = computed(() => rankStandings(sports.catalog.value.standings[team.value?.competition_id ?? ''] ?? [], sports.teamName)
  .find((row) => row.team_id === team.value?.id))
const recent = computed(() => team.value ? teamMatches(sports.catalog.value.matches, team.value.id, 5) : [])
const form = computed(() => team.value ? teamForm(sports.catalog.value.matches, team.value.id) : [])
const following = computed(() => (team.value ? followed.isFollowing(team.value.id) : false))

const summary = computed(() => {
  const row = standing.value
  return [
    { label: 'Posición', value: row?.position ?? '–' },
    { label: 'Puntos', value: row?.points ?? '–' },
    { label: 'Victorias', value: row?.won ?? '–' },
    { label: 'Empates', value: row?.drawn ?? '–' },
    { label: 'Derrotas', value: row?.lost ?? '–' },
  ]
})

const stats = computed(() => {
  const row = standing.value
  if (!row || !row.played) return []
  return [
    { label: 'Goles a favor', value: String(row.goals_for) },
    { label: 'Goles en contra', value: String(row.goals_against) },
    { label: 'Diferencia de goles', value: row.goal_difference > 0 ? `+${row.goal_difference}` : String(row.goal_difference) },
    { label: 'Victorias', value: `${Math.round((row.won / row.played) * 100)}%` },
    { label: 'Goles por partido', value: (row.goals_for / row.played).toFixed(1) },
    { label: 'Puntos por partido', value: (row.points / row.played).toFixed(2) },
  ]
})

const formClasses = { G: 'bg-primary text-canvas', E: 'bg-surface-3 text-text', P: 'bg-danger text-white' }
const formLabels = { G: 'Ganado', E: 'Empatado', P: 'Perdido' }
</script>

<template>
  <AppShell variant="app" active="leagues" :user-name="auth.state.profile?.display_name">
    <template v-if="sports.loading.value || sports.failed.value">
      <ScreenHeader title="Equipo" back />
      <CatalogBoundary :loading="sports.loading.value" :failed="sports.failed.value" @retry="sports.retry" />
    </template>

    <template v-else-if="team">
      <ScreenHeader back>
        <template #actions>
          <button type="button" class="press-scale icon-button" aria-label="Información del equipo" @click="infoOpen = true">
            <BadgeInfo class="h-5.5 w-5.5" />
          </button>
          <NotificationsButton />
        </template>
      </ScreenHeader>

      <div class="space-y-5 pb-28">
        <div class="flex flex-col items-center text-center">
          <TeamCrest :name="team.name" :short-name="team.short_name" :colors="team.colors" size="xl" />
          <h1 class="mt-3 font-display text-[26px] font-bold text-text">{{ team.name }}</h1>
          <RouterLink v-if="competition" :to="{ name: 'league', params: { leagueId: competition.id } }" class="mt-1 flex items-center gap-2 text-sm text-text hover:underline">
            <CompetitionEmblem :name="competition.name" :country="competition.country" :accent="competition.accent" />{{ competition.name }}
          </RouterLink>
          <p v-if="team.country || team.country_name" class="mt-1.5 flex items-center gap-2 text-sm text-text-muted"><CountryFlag v-if="team.country" :country="team.country" />{{ team.country_name }}</p>
          <PreviewBadge v-if="sports.preview" class="mt-3" />
        </div>

        <dl class="grid grid-cols-5 divide-x divide-border rounded-2xl border border-border bg-surface/60 py-3">
          <div v-for="item in summary" :key="item.label" class="flex flex-col-reverse items-center gap-0.5 px-1 text-center">
            <dt class="text-[11px] text-text-muted">{{ item.label }}</dt>
            <dd class="font-display text-2xl font-bold text-text">{{ item.value }}</dd>
          </div>
        </dl>

        <SegmentedTabs v-model="tab" :options="tabOptions" label="Secciones del equipo" variant="underline" />

        <section v-if="tab === 'partidos'">
          <SectionHeader title="Últimos partidos" :to="competition ? { name: 'league', params: { leagueId: competition.id }, query: { tab: 'partidos' } } : undefined" />
          <ul v-if="recent.length" class="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-linear-to-b from-surface-2/70 to-surface">
            <li v-for="match in recent" :key="match.id">
              <TeamMatchRow :match="match" :home="sports.team(match.home_team_id)" :away="sports.team(match.away_team_id)" :now="sports.now.value" />
            </li>
          </ul>
          <EmptyState v-else :icon="CalendarX2" title="Sin partidos jugados" description="Los resultados aparecerán cuando se publiquen." />
        </section>

        <EmptyState
          v-else-if="tab === 'plantilla'"
          :icon="Shirt"
          title="Plantilla no disponible"
          description="El MVP gestiona equipos y partidos; los jugadores no forman parte del modelo de datos todavía."
        />

        <section v-else class="space-y-4">
          <div v-if="form.length">
            <h2 class="mb-2 font-display text-base font-bold text-text">Racha</h2>
            <ol class="flex gap-2" aria-label="Últimos resultados, del más reciente al más antiguo">
              <li v-for="(result, index) in form" :key="index" class="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold" :class="formClasses[result]" :title="formLabels[result]">
                <span aria-hidden="true">{{ result }}</span><span class="sr-only">{{ formLabels[result] }}</span>
              </li>
            </ol>
          </div>
          <dl v-if="stats.length" class="grid grid-cols-2 gap-3">
            <div v-for="item in stats" :key="item.label" class="app-surface bg-linear-to-b from-surface-2/70 to-surface p-4">
              <dt class="text-xs text-text-muted">{{ item.label }}</dt>
              <dd class="mt-1 font-display text-2xl font-bold text-text">{{ item.value }}</dd>
            </div>
          </dl>
          <EmptyState v-else :icon="SearchX" title="Sin estadísticas todavía" description="Se calcularán con los resultados oficiales de la temporada." />
        </section>
      </div>

      <div class="pointer-events-none fixed inset-x-0 bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] z-20 mx-auto max-w-lg bg-linear-to-t from-canvas via-canvas/85 to-transparent px-5 pb-3 pt-8">
        <button
          type="button"
          class="press-scale pointer-events-auto flex w-full items-center justify-center gap-2 rounded-pill py-3.5 text-[15px] font-bold shadow-glow-primary"
          :class="following ? 'border border-primary bg-canvas text-primary' : 'bg-primary text-canvas'"
          :aria-pressed="following"
          @click="followed.toggle(team.id)"
        >
          <Star class="h-5 w-5" :fill="following ? 'currentColor' : 'none'" aria-hidden="true" />
          {{ following ? 'Siguiendo' : 'Seguir equipo' }}
        </button>
      </div>

      <BottomSheet v-model:open="infoOpen" :title="team.name">
        <dl class="space-y-3 text-sm">
          <div class="flex justify-between gap-3"><dt class="text-text-muted">Competición</dt><dd class="text-right font-semibold text-text">{{ competition?.name ?? '–' }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-text-muted">País</dt><dd class="text-right font-semibold text-text">{{ team.country_name || '–' }}</dd></div>
          <div class="flex justify-between gap-3"><dt class="text-text-muted">Temporada</dt><dd class="text-right font-semibold text-text">{{ competition?.season_label ?? '–' }}</dd></div>
        </dl>
        <p class="mt-4 text-xs text-text-faint">“Seguir equipo” se guarda solo en este dispositivo.</p>
      </BottomSheet>
    </template>

    <template v-else>
      <ScreenHeader title="Equipo" back />
      <EmptyState :icon="SearchX" title="No encontramos este equipo" description="Puede que el enlace sea antiguo o que el equipo aún no esté disponible.">
        <template #action><RouterLink :to="{ name: 'leagues' }" class="text-sm font-semibold text-primary hover:underline">Volver a Ligas</RouterLink></template>
      </EmptyState>
    </template>
  </AppShell>
</template>
