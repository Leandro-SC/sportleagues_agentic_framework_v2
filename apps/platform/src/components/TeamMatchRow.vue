<script setup lang="ts">
import { computed } from 'vue'
import { matchMoment, type Match, type Team } from '../lib/sports-catalog'
import TeamCrest from './TeamCrest.vue'

const props = defineProps<{ match: Match; home?: Team; away?: Team; now: Date }>()
const moment = computed(() => {
  const value = matchMoment(props.match, props.now)
  return props.match.status === 'live' ? `Hoy · ${value}` : value
})
</script>

<template>
  <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-3">
    <span class="flex min-w-0 items-center gap-2">
      <TeamCrest :name="home?.name ?? 'Local'" :short-name="home?.short_name" :colors="home?.colors" size="sm" />
      <span class="truncate text-sm font-medium text-text">{{ home?.name }}</span>
    </span>
    <span class="flex flex-col items-center">
      <span class="font-display text-base font-extrabold text-text">{{ match.home_score ?? '-' }} - {{ match.away_score ?? '-' }}</span>
      <span class="text-[11px] text-text-muted">{{ moment }}</span>
    </span>
    <span class="flex min-w-0 flex-col items-end gap-1">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate text-sm font-medium text-text">{{ away?.name }}</span>
        <TeamCrest :name="away?.name ?? 'Visita'" :short-name="away?.short_name" :colors="away?.colors" size="sm" />
      </span>
      <span v-if="match.status === 'live'" class="rounded-pill bg-primary px-2 py-0.5 text-[10px] font-bold text-canvas">En vivo</span>
    </span>
  </div>
</template>
