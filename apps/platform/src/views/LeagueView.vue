<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { CalendarX2, SearchX } from 'lucide-vue-next'
import heroBackground from '../assets/backgrounds/fondo_app_tablo.png'
import AppShell from '../components/AppShell.vue'
import CatalogBoundary from '../components/CatalogBoundary.vue'
import CompetitionEmblem from '../components/CompetitionEmblem.vue'
import CountryFlag from '../components/CountryFlag.vue'
import EmptyState from '../components/EmptyState.vue'
import NotificationsButton from '../components/NotificationsButton.vue'
import PreviewBadge from '../components/PreviewBadge.vue'
import ScoreboardCard from '../components/ScoreboardCard.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import SectionHeader from '../components/SectionHeader.vue'
import SegmentedTabs from '../components/SegmentedTabs.vue'
import ShareMenuButton from '../components/ShareMenuButton.vue'
import StandingsTable from '../components/StandingsTable.vue'
import TeamCrest from '../components/TeamCrest.vue'
import { useAuth } from '../composables/useAuth'
import { useRouteTab } from '../composables/useRouteTab'
import { useSportsCatalog } from '../composables/useSportsCatalog'
import { rankStandings, sortMatches } from '../lib/sports-catalog'

const TABS = ['resumen', 'equipos', 'partidos', 'tabla'] as const
type Tab = (typeof TABS)[number]

const route = useRoute()
const auth = useAuth()
const sports = useSportsCatalog()
const tab = useRouteTab<Tab>(TABS, 'resumen')

const tabOptions: Array<{ value: Tab; label: string }> = [
  { value: 'resumen', label: 'Resumen' },
  { value: 'equipos', label: 'Equipos' },
  { value: 'partidos', label: 'Partidos' },
  { value: 'tabla', label: 'Tabla' },
]

const competition = computed(() => sports.competition(String(route.params.leagueId ?? '')))
const standings = computed(() => rankStandings(sports.catalog.value.standings[competition.value?.id ?? ''] ?? [], sports.teamName))
const teams = computed(() => sports.catalog.value.teams.filter((team) => team.competition_id === competition.value?.id))
const matches = computed(() => sortMatches(sports.catalog.value.matches.filter((match) => match.tournament_id === competition.value?.id)))
const hasLive = computed(() => matches.value.some((match) => match.status === 'live'))
const leader = computed(() => sports.team(standings.value[0]?.team_id))
const shortName = computed(() => competition.value?.name.replace(/\s+(CL|AP)?\s*\d{4}.*$/, '') ?? '')
</script>

<template>
  <AppShell variant="app" active="leagues" :user-name="auth.state.profile?.display_name">
    <template v-if="sports.loading.value || sports.failed.value">
      <ScreenHeader title="Liga" :back="{ name: 'leagues' }" />
      <CatalogBoundary :loading="sports.loading.value" :failed="sports.failed.value" @retry="sports.retry" />
    </template>

    <template v-else-if="competition">
      <div class="relative -mx-5 overflow-hidden px-5 pb-12">
        <img :src="heroBackground" alt="" class="pointer-events-none absolute inset-0 h-full w-full object-cover object-[50%_72%]" />
        <div class="pointer-events-none absolute inset-0 bg-linear-to-b from-canvas/80 via-canvas/30 to-canvas" />
        <div class="relative">
          <ScreenHeader :back="{ name: 'leagues' }">
            <template #actions>
              <NotificationsButton />
              <ShareMenuButton :title="competition.name" />
            </template>
          </ScreenHeader>
          <div class="flex items-center gap-4 pb-16">
            <CompetitionEmblem :name="competition.name" :country="competition.country" :accent="competition.accent" size="lg" />
            <div class="min-w-0">
              <h1 class="truncate font-display text-[22px] font-bold text-text">{{ competition.name }}</h1>
              <p class="mt-1 flex items-center gap-2 text-sm text-text">
                <CountryFlag v-if="competition.country" :country="competition.country" />{{ competition.country_name || 'Competición' }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="-mt-10 space-y-5 pb-4">
        <div class="relative flex items-center gap-2">
          <SegmentedTabs v-model="tab" :options="tabOptions" label="Secciones de la liga" variant="chip" class="flex-1" />
        </div>
        <PreviewBadge v-if="sports.preview" />

        <template v-if="tab === 'resumen'">
          <div class="stadium-hero relative flex min-h-36 items-center overflow-hidden rounded-2xl border border-secondary/30 p-4">
            <div class="relative z-10 max-w-[62%] space-y-3">
              <p class="font-display text-base font-bold leading-snug text-text">La emoción de la {{ shortName }} en tus manos</p>
              <RouterLink
                :to="{ query: { tab: 'partidos' } }"
                class="press-scale inline-flex rounded-lg bg-primary px-4 py-2 text-xs font-bold text-canvas shadow-glow-primary"
              >{{ hasLive ? 'Ver partidos en vivo' : 'Ver partidos' }}</RouterLink>
            </div>
            <TeamCrest v-if="leader" :name="leader.name" :short-name="leader.short_name" :colors="leader.colors" size="xl" class="absolute -bottom-3 right-2 rotate-6 opacity-90" />
          </div>

          <section>
            <SectionHeader title="Tabla de posiciones" :to="{ query: { tab: 'tabla' } }" link-label="Ver completa" />
            <StandingsTable v-if="standings.length" :rows="standings.slice(0, 6)" :team="sports.team" :caption="`Tabla de posiciones de ${competition.name}`" />
            <EmptyState v-else :icon="SearchX" title="Tabla no disponible" description="La tabla aparecerá cuando haya resultados oficiales." />
          </section>
        </template>

        <ul v-else-if="tab === 'equipos'" class="grid grid-cols-2 gap-3">
          <li v-for="team in teams" :key="team.id">
            <RouterLink :to="{ name: 'team', params: { teamId: team.id } }" class="press-scale flex flex-col items-center gap-2 rounded-2xl border border-border bg-linear-to-b from-surface-2 to-surface px-3 py-4 text-center hover:border-border-strong">
              <TeamCrest :name="team.name" :short-name="team.short_name" :colors="team.colors" size="lg" />
              <span class="w-full truncate text-sm font-semibold text-text">{{ team.name }}</span>
            </RouterLink>
          </li>
        </ul>

        <template v-else-if="tab === 'partidos'">
          <ul v-if="matches.length" class="space-y-3">
            <li v-for="match in matches" :key="match.id">
              <ScoreboardCard :match="match" :competition="competition" :home="sports.team(match.home_team_id)" :away="sports.team(match.away_team_id)" :now="sports.now.value" />
            </li>
          </ul>
          <EmptyState v-else :icon="CalendarX2" title="Sin partidos programados" description="Los partidos aparecerán cuando el organizador cargue la jornada." />
        </template>

        <template v-else>
          <StandingsTable v-if="standings.length" :rows="standings" :team="sports.team" detailed :caption="`Tabla completa de ${competition.name}`" />
          <EmptyState v-else :icon="SearchX" title="Tabla no disponible" description="La tabla aparecerá cuando haya resultados oficiales." />
          <p v-if="standings.length" class="mt-3 text-xs text-text-faint">Orden: puntos, diferencia de goles y goles a favor.</p>
        </template>
      </div>
    </template>

    <template v-else>
      <ScreenHeader title="Liga" :back="{ name: 'leagues' }" />
      <EmptyState :icon="SearchX" title="No encontramos esta liga" description="Puede que el enlace sea antiguo o que la liga aún no esté disponible.">
        <template #action><RouterLink :to="{ name: 'leagues' }" class="text-sm font-semibold text-primary hover:underline">Volver a Ligas</RouterLink></template>
      </EmptyState>
    </template>
  </AppShell>
</template>
