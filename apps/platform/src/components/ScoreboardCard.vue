<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { kickoffLabel, matchMoment, type Competition, type Match, type Team } from '../lib/sports-catalog'
import CompetitionEmblem from './CompetitionEmblem.vue'
import MatchStatusPill from './MatchStatusPill.vue'
import TeamCrest from './TeamCrest.vue'

const props = defineProps<{ match: Match; competition?: Competition; home?: Team; away?: Team; now: Date }>()

const label = computed(() => kickoffLabel(props.match, props.now))
const moment = computed(() => matchMoment(props.match, props.now))
const hasScore = computed(() => props.match.home_score != null && props.match.away_score != null)
const summary = computed(() => {
  const home = props.home?.name ?? 'Local'
  const away = props.away?.name ?? 'Visita'
  const score = hasScore.value ? `${props.match.home_score} a ${props.match.away_score}` : 'por jugar'
  return `${home} contra ${away}, ${score}, ${label.value.text}`
})
</script>

<template>
  <article class="app-surface overflow-hidden bg-linear-to-b from-surface-2/70 to-surface">
    <RouterLink
      :to="{ name: 'league', params: { leagueId: match.tournament_id }, query: { tab: 'partidos' } }"
      class="block px-4 pb-4 pt-3 hover:bg-surface-2/40"
      :aria-label="summary"
    >
      <div class="flex items-center justify-between gap-2">
        <p class="flex min-w-0 items-center gap-2 text-xs font-semibold text-text">
          <CompetitionEmblem v-if="competition" :name="competition.name" :country="competition.country" :accent="competition.accent" />
          <span class="truncate">{{ competition?.name }}</span>
        </p>
        <MatchStatusPill :label="label" />
      </div>
      <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2" aria-hidden="true">
        <div class="flex min-w-0 flex-col items-center gap-1.5 text-center">
          <TeamCrest :name="home?.name ?? 'Local'" :short-name="home?.short_name" :colors="home?.colors" size="md" />
          <span class="w-full truncate text-xs font-semibold text-text">{{ home?.name }}</span>
        </div>
        <div class="flex min-w-16 flex-col items-center">
          <span v-if="hasScore" class="font-display text-2xl font-extrabold tracking-wide text-text">{{ match.home_score }} - {{ match.away_score }}</span>
          <span v-else class="font-display text-lg font-bold text-text-muted">vs</span>
          <span class="mt-0.5 text-xs font-semibold" :class="match.status === 'live' ? 'text-primary' : 'text-text-muted'">{{ moment }}</span>
        </div>
        <div class="flex min-w-0 flex-col items-center gap-1.5 text-center">
          <TeamCrest :name="away?.name ?? 'Visita'" :short-name="away?.short_name" :colors="away?.colors" size="md" />
          <span class="w-full truncate text-xs font-semibold text-text">{{ away?.name }}</span>
        </div>
      </div>
    </RouterLink>
  </article>
</template>
