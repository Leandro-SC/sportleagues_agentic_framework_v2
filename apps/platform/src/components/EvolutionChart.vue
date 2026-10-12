<script setup lang="ts">
import { computed } from 'vue'
import type { EvolutionPoint } from '../composables/usePoolStats'

// Evolución de mis puntos acumulados por jornada frente al promedio de la quiniela. Solo dibuja los puntos que entrega el servidor;
// con menos de dos jornadas con resultados no hay línea que trazar y se muestra un estado honesto.
const props = defineProps<{ points: EvolutionPoint[] }>()
const W = 320
const H = 120
const PAD = 14

const series = computed(() => props.points.filter((p) => p.my_cumulative !== null))
const avgCumulative = computed(() => { let acc = 0; return props.points.map((p) => (acc += p.avg_points)) })
const max = computed(() => Math.max(1, ...series.value.map((p) => p.my_cumulative ?? 0), ...avgCumulative.value))
const x = (i: number, n: number): number => (n <= 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1))
const y = (v: number): number => H - PAD - (v / max.value) * (H - 2 * PAD)
const line = (values: number[]): string => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i, values.length).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
const mine = computed(() => line(series.value.map((p) => p.my_cumulative ?? 0)))
const avg = computed(() => line(avgCumulative.value))
</script>

<template>
  <div>
    <p v-if="series.length < 2" class="rounded-xl bg-surface-2 p-3 text-sm text-text-muted">La evolución aparece cuando haya resultados en al menos dos jornadas.</p>
    <figure v-else>
      <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="Evolución de tus puntos acumulados por jornada">
        <path :d="avg" fill="none" stroke="#5c7889" stroke-width="2" stroke-dasharray="4 4" />
        <path :d="mine" fill="none" stroke="#21f59a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        <circle v-for="(p, i) in series" :key="p.round_id" :cx="x(i, series.length)" :cy="y(p.my_cumulative ?? 0)" r="4" fill="#21f59a" />
      </svg>
      <figcaption class="mt-1 flex items-center justify-between text-xs text-text-muted">
        <span><span class="text-primary">━</span> Tus puntos acumulados</span>
        <span><span>╍</span> Promedio de la quiniela</span>
      </figcaption>
    </figure>
  </div>
</template>
