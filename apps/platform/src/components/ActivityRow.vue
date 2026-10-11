<script setup lang="ts">
import { type Component } from 'vue'
import { Award, Goal, Target, UserRoundCheck } from 'lucide-vue-next'
import { relativeTimeLabel, type ActivityItem, type ActivityKind } from '../lib/sports-catalog'

defineProps<{ item: ActivityItem; now: Date }>()

const visuals: Record<ActivityKind, { icon: Component; classes: string }> = {
  joined: { icon: UserRoundCheck, classes: 'bg-primary-100 text-primary ring-primary/40' },
  prediction: { icon: Target, classes: 'bg-warn-100 text-warn ring-warn/40' },
  match: { icon: Goal, classes: 'bg-danger-100 text-danger ring-danger/40' },
  achievement: { icon: Award, classes: 'bg-[#2a1f4a] text-[#a78bfa] ring-[#a78bfa]/40' },
}
</script>

<template>
  <li class="app-surface flex items-center gap-3 bg-linear-to-r from-surface-2/70 to-surface px-3.5 py-3">
    <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full ring-2" :class="visuals[item.kind].classes">
      <component :is="visuals[item.kind].icon" class="h-5 w-5" aria-hidden="true" />
    </span>
    <span class="min-w-0">
      <span class="block text-sm font-medium text-text">{{ item.title }}</span>
      <span class="block truncate text-sm text-text">{{ item.detail }}</span>
      <span class="block text-xs text-text-muted">{{ relativeTimeLabel(item.occurred_at, now) }}</span>
    </span>
  </li>
</template>
