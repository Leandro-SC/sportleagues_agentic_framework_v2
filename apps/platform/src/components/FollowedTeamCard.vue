<script setup lang="ts">
import { RouterLink } from 'vue-router'
import type { Team } from '../lib/sports-catalog'
import TeamCrest from './TeamCrest.vue'

defineProps<{ team: Team; subtitle: string }>()
</script>

<template>
  <RouterLink
    :to="{ name: 'team', params: { teamId: team.id } }"
    class="press-scale flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-linear-to-br from-surface-2 to-surface px-3 py-3.5 hover:border-border-strong"
  >
    <TeamCrest :name="team.name" :short-name="team.short_name" :colors="team.colors" size="md" />
    <span class="min-w-0">
      <span class="line-clamp-2 block text-sm font-semibold leading-tight text-text">{{ team.name }}</span>
      <span v-if="subtitle" class="block truncate text-xs text-text-muted">{{ subtitle }}</span>
    </span>
  </RouterLink>
</template>
