<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { kickoffLabel, type Competition, type Match, type Team } from '../lib/sports-catalog'
import CompetitionEmblem from './CompetitionEmblem.vue'
import TeamCrest from './TeamCrest.vue'

defineProps<{ match: Match; competition?: Competition; home?: Team; away?: Team; now: Date }>()
</script>

<template>
  <RouterLink
    :to="{ name: 'league', params: { leagueId: match.tournament_id }, query: { tab: 'partidos' } }"
    class="app-surface block bg-linear-to-b from-surface-2/70 to-surface px-4 py-3.5 hover:border-border-strong"
  >
    <div class="flex items-center justify-between gap-2 text-xs">
      <span class="flex min-w-0 items-center gap-2 font-medium text-text-muted">
        <CompetitionEmblem v-if="competition" :name="competition.name" :country="competition.country" :accent="competition.accent" />
        <span class="truncate">{{ competition?.name }}</span>
      </span>
      <span class="shrink-0 font-semibold text-text">{{ kickoffLabel(match, now).text }}</span>
    </div>
    <div class="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <span class="flex min-w-0 items-center justify-end gap-2">
        <span class="line-clamp-2 text-right text-sm font-semibold leading-tight text-text">{{ home?.name }}</span>
        <TeamCrest :name="home?.name ?? 'Local'" :short-name="home?.short_name" :colors="home?.colors" size="sm" />
      </span>
      <span class="text-xs font-semibold text-text-muted">vs</span>
      <span class="flex min-w-0 items-center gap-2">
        <TeamCrest :name="away?.name ?? 'Visita'" :short-name="away?.short_name" :colors="away?.colors" size="sm" />
        <span class="line-clamp-2 text-sm font-semibold leading-tight text-text">{{ away?.name }}</span>
      </span>
    </div>
  </RouterLink>
</template>
