<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue'

withDefaults(
  defineProps<{
    skeleton?: boolean
    position?: number
    name?: string
    points?: number
    isCurrentUser?: boolean
  }>(),
  { skeleton: false, isCurrentUser: false },
)
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-xl px-3 py-2.5"
    :class="isCurrentUser ? 'border border-primary/40 bg-primary-100/50' : 'border border-transparent'"
  >
    <template v-if="skeleton">
      <LoadingSkeleton width="1.75rem" height="1.75rem" rounded="rounded-full" />
      <LoadingSkeleton width="55%" height="0.875rem" />
      <LoadingSkeleton width="2.5rem" height="0.875rem" />
    </template>
    <template v-else>
      <span
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        :class="isCurrentUser ? 'bg-primary text-canvas' : 'bg-surface-2 text-text-muted'"
      >{{ position }}</span>
      <p class="flex-1 truncate text-sm font-medium text-text">{{ name }}</p>
      <p class="font-display text-sm font-bold text-text">{{ points }} pts</p>
    </template>
  </div>
</template>
