<script setup lang="ts">
import type { KickoffLabel } from '../lib/sports-catalog'

defineProps<{ label: KickoffLabel }>()
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
    :class="{
      'border border-primary/60 bg-primary-100/70 text-primary shadow-sm': label.tone === 'live',
      'border border-secondary/30 bg-[#0f2e3f] text-[#8fa6b5]': label.tone === 'final',
      'border border-border bg-surface-2 text-text-muted': label.tone === 'today' || label.tone === 'neutral',
    }"
  >
    <span v-if="label.tone === 'live'" class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
    <span v-if="label.tone === 'live'">⭐</span>
    {{ label.text }}
  </span>
</template>
