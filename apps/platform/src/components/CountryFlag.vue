<script setup lang="ts">
import type { CountryCode } from '../lib/sports-catalog'

// Banderas simplificadas en SVG (sin emoji: Windows no renderiza banderas emoji).
withDefaults(defineProps<{ country: CountryCode; label?: string; size?: 'xs' | 'sm' }>(), { size: 'sm' })
</script>

<template>
  <svg
    viewBox="0 0 30 20"
    class="shrink-0 overflow-hidden rounded-[3px] ring-1 ring-white/15"
    :class="size === 'xs' ? 'h-3 w-[18px]' : 'h-3.5 w-[21px]'"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  >
    <template v-if="country === 'MX'">
      <rect width="10" height="20" fill="#006847" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#ce1126" />
      <circle cx="15" cy="10" r="2.4" fill="#8c5a2b" />
    </template>
    <template v-else-if="country === 'IT'">
      <rect width="10" height="20" fill="#009246" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#ce2b37" />
    </template>
    <template v-else-if="country === 'PE'">
      <rect width="10" height="20" fill="#d91023" /><rect x="10" width="10" height="20" fill="#fff" /><rect x="20" width="10" height="20" fill="#d91023" />
    </template>
    <template v-else-if="country === 'ES'">
      <rect width="30" height="20" fill="#aa151b" /><rect y="5" width="30" height="10" fill="#f1bf00" />
    </template>
    <template v-else-if="country === 'GB'">
      <rect width="30" height="20" fill="#fff" /><rect x="12.5" width="5" height="20" fill="#ce1124" /><rect y="7.5" width="30" height="5" fill="#ce1124" />
    </template>
    <template v-else-if="country === 'AR'">
      <rect width="30" height="20" fill="#74acdf" /><rect y="6.67" width="30" height="6.66" fill="#fff" /><circle cx="15" cy="10" r="2" fill="#f6b40e" />
    </template>
    <template v-else>
      <rect width="30" height="20" fill="#009c3b" /><path d="M15 2.5 27 10 15 17.5 3 10Z" fill="#ffdf00" /><circle cx="15" cy="10" r="4" fill="#002776" />
    </template>
  </svg>
</template>
