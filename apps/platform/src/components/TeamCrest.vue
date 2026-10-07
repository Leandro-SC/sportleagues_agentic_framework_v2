<script setup lang="ts">
import { computed, useId } from 'vue'
import { readableTextColor } from '../lib/color-contrast'

// Escudo genérico con los colores e iniciales del equipo. No reproduce escudos oficiales: cuando
// Fase 06 publique `teams.crest_asset_path`, la imagen del organizador podrá sustituir este fallback.
const props = withDefaults(
  defineProps<{ name: string; shortName?: string; colors?: [string, string]; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }>(),
  { colors: () => ['#1c3c50', '#0f2e3f'], size: 'md' },
)

const gradientId = `crest-${useId()}`
const label = computed(() => (props.shortName ?? props.name.slice(0, 3)).toUpperCase())
const ink = computed(() => readableTextColor(props.colors[0]))
const sizeClass: Record<string, string> = { xs: 'h-6 w-6', sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12', xl: 'h-24 w-24' }
</script>

<template>
  <svg viewBox="0 0 40 44" class="shrink-0 drop-shadow-[0_4px_10px_rgba(0,0,0,0.35)]" :class="sizeClass[size]" role="img" :aria-label="`Escudo de ${name}`">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" :stop-color="colors[0]" />
        <stop offset="0.62" :stop-color="colors[0]" />
        <stop offset="0.62" :stop-color="colors[1]" />
        <stop offset="1" :stop-color="colors[1]" />
      </linearGradient>
    </defs>
    <path d="M20 2 37 7.5V20c0 10.5-7.4 18.6-17 22C10.4 38.6 3 30.5 3 20V7.5Z" :fill="`url(#${gradientId})`" stroke="rgba(255,255,255,0.55)" stroke-width="1.6" />
    <path d="M20 6.2 33.4 10.6V20c0 8.3-5.6 14.8-13.4 17.6C12.2 34.8 6.6 28.3 6.6 20v-9.4Z" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1" />
    <text x="20" y="22.5" text-anchor="middle" font-family="Manrope, Inter, sans-serif" font-size="10" font-weight="800" :fill="ink">{{ label }}</text>
  </svg>
</template>
