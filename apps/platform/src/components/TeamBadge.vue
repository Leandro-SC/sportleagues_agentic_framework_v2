<script setup lang="ts">
import { computed } from 'vue'
import { flagSrc } from '../lib/catalog-local'
import TeamCrest from './TeamCrest.vue'

// Selecciones nacionales → bandera autorizada (flag-icons, MIT, servida desde /flags). Clubes → escudo generado por iniciales y colores:
// no hay fuente libre autorizada de escudos de clubes (ADR-009/016), por eso no se descargan ni se muestran logos de terceros.
const props = withDefaults(
  defineProps<{ name: string; kind?: 'club' | 'national' | null; countryCode?: string | null; shortName?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }>(),
  { kind: 'club', countryCode: null, size: 'sm' },
)
const src = computed(() => (props.kind === 'national' ? flagSrc(props.countryCode) : null))
const sizeClass: Record<string, string> = { xs: 'h-6 w-6', sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="`Bandera de ${name}`"
    loading="lazy"
    decoding="async"
    class="shrink-0 rounded-full object-cover ring-1 ring-white/20"
    :class="sizeClass[size]"
  />
  <TeamCrest v-else :name="name" :short-name="shortName" :size="size" />
</template>
