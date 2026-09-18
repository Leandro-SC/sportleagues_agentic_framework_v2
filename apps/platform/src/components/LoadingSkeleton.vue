<script setup lang="ts">
withDefaults(defineProps<{ width?: string; height?: string; rounded?: string }>(), {
  width: '100%',
  height: '1rem',
  rounded: 'rounded-lg',
})
</script>

<template>
  <span class="skeleton-shimmer block" :class="rounded" :style="{ width, height }" />
</template>
