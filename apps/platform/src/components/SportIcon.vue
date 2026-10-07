<script setup lang="ts">
import { Volleyball } from 'lucide-vue-next'
import type { SportFilter } from '../lib/sports-catalog'

// Lucide no incluye balón de fútbol, básquet ni tenis: se dibujan aquí con su misma grilla
// (24×24, trazo 2, extremos redondeados) para que convivan con el resto de iconos.
defineProps<{ sport: SportFilter }>()
</script>

<template>
  <Volleyball v-if="sport === 'volleyball'" aria-hidden="true" />
  <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <template v-if="sport === 'basketball'">
      <path d="M12 2v20" />
      <path d="M2 12h20" />
      <path d="M5.2 4.7C7.6 6.6 9 9.2 9 12s-1.4 5.4-3.8 7.3" />
      <path d="M18.8 4.7C16.4 6.6 15 9.2 15 12s1.4 5.4 3.8 7.3" />
    </template>
    <template v-else-if="sport === 'tennis'">
      <path d="M2.3 9.6c4.5.5 8 4.4 8 9.1 0 1.1-.2 2.2-.5 3.1" />
      <path d="M21.7 14.4c-4.5-.5-8-4.4-8-9.1 0-1.1.2-2.2.5-3.1" />
    </template>
    <template v-else>
      <path d="m12 7.5 4.3 3.1-1.6 5h-5.4l-1.6-5Z" />
      <path d="M12 7.5V2.6" />
      <path d="m16.3 10.6 4.4-1.7" />
      <path d="m14.7 15.6 2.8 4" />
      <path d="m9.3 15.6-2.8 4" />
      <path d="m7.7 10.6-4.4-1.7" />
    </template>
  </svg>
</template>
