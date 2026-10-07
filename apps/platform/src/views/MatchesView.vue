<script setup lang="ts">
import { computed, ref } from 'vue'
import { CalendarX2 } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import EmptyState from '../components/EmptyState.vue'
import PreviewBadge from '../components/PreviewBadge.vue'
import ScoreboardCard from '../components/ScoreboardCard.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import SegmentedTabs from '../components/SegmentedTabs.vue'
import SportIcon from '../components/SportIcon.vue'
import { useAuth } from '../composables/useAuth'
import { useSportsCatalog } from '../composables/useSportsCatalog'
import { matchesForSport, matchesInWindow, SPORT_LABELS, type MatchWindow, type SportFilter } from '../lib/sports-catalog'

const auth = useAuth()
const sports = useSportsCatalog()

const dayWindow = ref<MatchWindow>('today')
const sport = ref<SportFilter>('all')

const windowOptions: Array<{ value: MatchWindow; label: string }> = [
  { value: 'today', label: 'Hoy' },
  { value: 'tomorrow', label: 'Mañana' },
  { value: 'week', label: 'Esta semana' },
]
const sportOptions: Array<{ value: SportFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  ...(Object.keys(SPORT_LABELS) as Array<keyof typeof SPORT_LABELS>).map((key) => ({ value: key, label: SPORT_LABELS[key] })),
]

const matches = computed(() => matchesInWindow(
  matchesForSport(sports.catalog.value.matches, sports.catalog.value.competitions, sport.value),
  dayWindow.value,
  sports.now.value,
))

const emptyCopy = computed(() => {
  if (!sports.preview) return { title: 'Aún no hay partidos cargados', description: 'Cuando tu organizador cargue la parrilla de partidos, aparecerán aquí.' }
  const when = windowOptions.find((option) => option.value === dayWindow.value)!.label.toLowerCase()
  const what = sport.value === 'all' ? 'partidos' : `partidos de ${SPORT_LABELS[sport.value].toLowerCase()}`
  return { title: `Sin ${what} ${dayWindow.value === 'week' ? 'esta semana' : `para ${when}`}`, description: 'Prueba con otro día o deporte.' }
})
</script>

<template>
  <AppShell variant="app" active="matches" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Partidos" large>
      <template v-if="sports.preview" #actions><PreviewBadge /></template>
    </ScreenHeader>

    <div class="space-y-4">
      <SegmentedTabs v-model="dayWindow" :options="windowOptions" label="Día de los partidos" variant="pill" />

      <div role="radiogroup" aria-label="Deporte" class="grid grid-cols-5 gap-1 border-b border-border pb-3">
        <button
          v-for="option in sportOptions"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="sport === option.value"
          class="press-scale flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-[11px] font-semibold transition-colors"
          :class="sport === option.value ? 'border-primary/70 bg-primary-100/60 text-text shadow-glow-primary' : 'border-transparent text-text-muted hover:text-text'"
          @click="sport = option.value"
        >
          <SportIcon :sport="option.value" class="h-6 w-6" />
          {{ option.label }}
        </button>
      </div>

      <ul v-if="matches.length" class="space-y-3" aria-label="Partidos">
        <li v-for="match in matches" :key="match.id">
          <ScoreboardCard
            :match="match"
            :competition="sports.competition(match.tournament_id)"
            :home="sports.team(match.home_team_id)"
            :away="sports.team(match.away_team_id)"
            :now="sports.now.value"
          />
        </li>
      </ul>
      <EmptyState v-else :icon="CalendarX2" :title="emptyCopy.title" :description="emptyCopy.description" />
    </div>
  </AppShell>
</template>
