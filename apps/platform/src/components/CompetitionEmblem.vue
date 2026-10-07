<script setup lang="ts">
import { computed } from 'vue'
import { readableTextColor } from '../lib/color-contrast'
import type { CountryCode } from '../lib/sports-catalog'
import CountryFlag from './CountryFlag.vue'

const props = withDefaults(
  defineProps<{ name: string; country?: CountryCode | null; accent?: string; size?: 'sm' | 'md' | 'lg' }>(),
  { country: null, accent: '#16d8f4', size: 'sm' },
)

const initials = computed(() => props.name.split(/\s+/).filter((word) => /^[A-Za-zÁÉÍÓÚÑ0-9]/.test(word)).slice(0, 2).map((word) => word[0]!.toUpperCase()).join(''))
const sizeClass: Record<string, string> = { sm: 'h-5 w-5 text-[8px]', md: 'h-8 w-8 text-[10px]', lg: 'h-14 w-14 text-sm' }
</script>

<template>
  <span
    class="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-extrabold ring-1 ring-white/20"
    :class="sizeClass[size]"
    :style="country ? { background: '#f7fafc' } : { background: accent, color: readableTextColor(accent) }"
    aria-hidden="true"
  >
    <CountryFlag v-if="country" :country="country" size="xs" class="scale-[1.6] rounded-none! ring-0!" />
    <template v-else>{{ initials }}</template>
  </span>
</template>
