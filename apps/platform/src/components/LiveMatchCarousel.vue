<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import type { Competition, Match, Team } from '../lib/sports-catalog'
import CompetitionEmblem from './CompetitionEmblem.vue'
import TeamCrest from './TeamCrest.vue'

defineProps<{ matches: Match[]; competition: (id: string) => Competition | undefined; team: (id: string) => Team | undefined }>()

const active = ref(0)
const track = ref<HTMLElement | null>(null)

function onScroll(): void {
  const element = track.value
  if (!element || !element.clientWidth) return
  active.value = Math.round(element.scrollLeft / element.clientWidth)
}

function goTo(index: number): void {
  track.value?.scrollTo({ left: index * (track.value?.clientWidth ?? 0), behavior: 'smooth' })
}
</script>

<template>
  <section aria-label="Partidos en vivo" class="relative">
    <div ref="track" class="flex snap-x snap-mandatory overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden" @scroll.passive="onScroll">
      <RouterLink
        v-for="match in matches"
        :key="match.id"
        :to="{ name: 'league', params: { leagueId: match.tournament_id }, query: { tab: 'partidos' } }"
        class="stadium-hero relative w-full shrink-0 snap-center overflow-hidden rounded-2xl border border-secondary/30 px-4 pb-7 pt-3 shadow-md"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="flex min-w-0 items-center gap-2 text-xs font-semibold text-text">
            <CompetitionEmblem v-if="competition(match.tournament_id)" :name="competition(match.tournament_id)!.name" :country="competition(match.tournament_id)!.country" :accent="competition(match.tournament_id)!.accent" size="md" />
            <span class="truncate">{{ competition(match.tournament_id)?.name }}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 rounded-pill bg-danger px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
            <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />En vivo
          </span>
        </div>
        <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span class="flex min-w-0 flex-col items-center gap-1.5">
            <TeamCrest :name="team(match.home_team_id)?.name ?? 'Local'" :short-name="team(match.home_team_id)?.short_name" :colors="team(match.home_team_id)?.colors" size="lg" />
            <span class="w-full truncate text-center text-sm font-semibold text-text">{{ team(match.home_team_id)?.name }}</span>
          </span>
          <span class="flex flex-col items-center">
            <span class="font-display text-4xl font-extrabold tracking-wide text-text">{{ match.home_score }} - {{ match.away_score }}</span>
            <span class="text-xs font-bold text-primary">{{ match.minute }}'</span>
          </span>
          <span class="flex min-w-0 flex-col items-center gap-1.5">
            <TeamCrest :name="team(match.away_team_id)?.name ?? 'Visita'" :short-name="team(match.away_team_id)?.short_name" :colors="team(match.away_team_id)?.colors" size="lg" />
            <span class="w-full truncate text-center text-sm font-semibold text-text">{{ team(match.away_team_id)?.name }}</span>
          </span>
        </div>
      </RouterLink>
    </div>
    <div v-if="matches.length > 1" class="absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
      <button
        v-for="(match, index) in matches"
        :key="match.id"
        type="button"
        class="h-1.5 rounded-pill transition-all"
        :class="index === active ? 'w-4 bg-text' : 'w-1.5 bg-text/40'"
        :aria-label="`Ver partido ${index + 1} de ${matches.length}`"
        :aria-current="index === active ? 'true' : undefined"
        @click="goTo(index)"
      />
    </div>
  </section>
</template>
