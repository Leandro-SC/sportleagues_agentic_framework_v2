<script setup lang="ts">
import type { KickoffLabel } from '../lib/sports-catalog'

defineProps<{ label: KickoffLabel }>()
</script>

<template>
  <span
    class="inline-flex shrink-0 items-center gap-1.5 rounded-pill text-[11px] font-semibold"
    :class="{
      'border border-primary/50 bg-primary-100 px-2 py-0.5 text-primary': label.tone === 'live',
      'bg-surface-3 px-2 py-0.5 text-text-muted': label.tone === 'final',
      'border border-primary/40 px-2 py-0.5 text-primary': label.tone === 'today',
      'text-text-muted': label.tone === 'neutral',
    }"
  >
    <span v-if="label.tone === 'live'" class="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
    {{ label.text }}
  </span>
</template>
