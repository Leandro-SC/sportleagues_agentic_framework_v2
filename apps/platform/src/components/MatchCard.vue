<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import LoadingSkeleton from './LoadingSkeleton.vue'
import StatChip from './StatChip.vue'

withDefaults(
  defineProps<{
    skeleton?: boolean
    homeTeam?: string
    awayTeam?: string
    kickoffLabel?: string
    status?: 'scheduled' | 'live' | 'finished'
    scoreHome?: number | null
    scoreAway?: number | null
    predictionHome?: number | null
    predictionAway?: number | null
    points?: number | null
    locked?: boolean
  }>(),
  { skeleton: false, status: 'scheduled', locked: false },
)
</script>

<template>
  <div class="app-surface p-4">
    <template v-if="skeleton">
      <div class="flex items-center justify-between">
        <LoadingSkeleton width="6rem" height="0.875rem" />
        <LoadingSkeleton width="3rem" height="0.875rem" />
      </div>
      <div class="mt-3 flex items-center justify-between">
        <LoadingSkeleton width="40%" height="1.25rem" />
        <LoadingSkeleton width="2rem" height="1.25rem" />
        <LoadingSkeleton width="40%" height="1.25rem" />
      </div>
    </template>
    <template v-else>
      <div class="flex items-center justify-between text-xs font-medium text-text-muted">
        <span>{{ kickoffLabel }}</span>
        <StatChip v-if="locked" label="Bloqueado" :icon="Lock" tone="neutral" />
        <StatChip v-else-if="status === 'live'" label="En vivo" tone="danger" />
        <StatChip v-else-if="status === 'finished'" label="Finalizado" tone="neutral" />
      </div>
      <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <p class="truncate text-right text-sm font-semibold text-text">{{ homeTeam }}</p>
        <p class="font-display text-lg font-bold text-text">
          <span v-if="scoreHome != null && scoreAway != null">{{ scoreHome }} - {{ scoreAway }}</span>
          <span v-else class="text-text-faint">vs</span>
        </p>
        <p class="truncate text-sm font-semibold text-text">{{ awayTeam }}</p>
      </div>
      <div v-if="predictionHome != null && predictionAway != null" class="mt-3 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">
        <span>Tu predicción: {{ predictionHome }} - {{ predictionAway }}</span>
        <span v-if="points != null" class="font-semibold text-primary">+{{ points }} pts</span>
      </div>
    </template>
  </div>
</template>
