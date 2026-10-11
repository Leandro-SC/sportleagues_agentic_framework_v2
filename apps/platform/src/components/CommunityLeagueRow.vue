<script setup lang="ts">
import { SPORT_LABELS, type CommunityLeague } from '../lib/sports-catalog'
import TeamCrest from './TeamCrest.vue'

defineProps<{ league: CommunityLeague }>()
defineEmits<{ join: [league: CommunityLeague] }>()
</script>

<template>
  <li class="app-surface flex items-center gap-3 bg-linear-to-r from-surface-2/70 to-surface px-3 py-3">
    <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-3 ring-1 ring-white/15">
      <TeamCrest :name="league.name" :colors="league.colors" size="sm" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block truncate text-sm font-semibold text-text">{{ league.name }}</span>
      <span class="block text-xs font-medium tracking-wide text-text-muted">#{{ league.code }}</span>
      <span class="block truncate text-xs text-text-muted">
        {{ SPORT_LABELS[league.sport] }} · {{ league.teams_count ? `${league.teams_count} equipos` : `${league.members_count} miembros` }}
      </span>
    </span>
    <button type="button" class="press-scale shrink-0 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-canvas" :aria-label="`Unirse a ${league.name}`" @click="$emit('join', league)">Unirse</button>
  </li>
</template>
