<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import StatChip from './StatChip.vue'
import type { ResultsMode } from '../lib/sports-admin'

// Modo de resultados del torneo. Manual: todos los planes. Automático: función Premium FUTURA; la disponibilidad que muestra esta
// pantalla es informativa: la base de datos vuelve a comprobar interruptor de plataforma y plan al cambiar el modo.
defineProps<{ mode: ResultsMode; autoAvailable: boolean; saving: boolean }>()
defineEmits<{ select: [mode: ResultsMode] }>()
</script>

<template>
  <div class="space-y-3 rounded-xl border border-border p-3" data-test="results-mode">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-display font-bold text-text">Modo de resultados</h3>
      <StatChip :label="mode === 'manual' ? 'Manual' : 'Automático'" :tone="mode === 'manual' ? 'neutral' : 'success'" />
    </div>
    <label class="flex min-h-[44px] items-start gap-3">
      <input type="radio" name="results-mode" class="mt-1 h-4 w-4 accent-primary" :checked="mode === 'manual'" :disabled="saving" @change="$emit('select', 'manual')" />
      <span class="text-sm"><span class="font-semibold text-text">Manual</span><span class="block text-text-muted">Tú publicas y corriges los marcadores. Los puntos y el ranking se recalculan solos.</span></span>
    </label>
    <label class="flex min-h-[44px] items-start gap-3" :class="autoAvailable ? '' : 'opacity-60'">
      <input type="radio" name="results-mode" class="mt-1 h-4 w-4 accent-primary" :checked="mode === 'automatic'" :disabled="!autoAvailable || saving" @change="$emit('select', 'automatic')" />
      <span class="text-sm">
        <span class="flex items-center gap-2 font-semibold text-text">Automático <Lock v-if="!autoAvailable" class="h-3.5 w-3.5 text-text-muted" aria-hidden="true" /><span v-if="!autoAvailable" class="text-xs font-semibold text-warn">Premium · próximamente</span></span>
        <span class="block text-text-muted">Un proveedor deportivo actualizará los marcadores de los partidos vinculados. Un resultado que tú publiques nunca se sobrescribe sin avisarte.</span>
      </span>
    </label>
  </div>
</template>
