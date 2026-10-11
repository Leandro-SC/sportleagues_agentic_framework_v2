<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Lock } from 'lucide-vue-next'
import PrimaryButton from './PrimaryButton.vue'
import StatChip from './StatChip.vue'
import type { FixtureItem } from '../composables/usePoolPlay'
import { lockLabel, lockStateFromServer, parseScoreInput } from '../lib/prediction-ux'

// Tarjeta de un partido de la quiniela. El cierre mostrado viene del servidor (`lock_at`); el reloj local solo decide si se ofrece el
// formulario. `save_prediction` revalida en la base de datos y un rechazo se muestra tal cual en `message`.
const props = defineProps<{ item: FixtureItem; now: Date; timezone: string; canPredict: boolean; saving: boolean; message?: string }>()
const emit = defineEmits<{ save: [home: number, away: number] }>()

const home = ref(props.item.mine ? String(props.item.mine.home) : '')
const away = ref(props.item.mine ? String(props.item.mine.away) : '')
const localError = ref('')
watch(() => props.item.mine, (mine) => { if (mine) { home.value = String(mine.home); away.value = String(mine.away) } })

const state = computed(() => lockStateFromServer(props.item.status, props.item.lockAt, props.now))
const kickoff = computed(() => new Intl.DateTimeFormat('es', { timeZone: props.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(props.item.startsAt)))
const label = computed(() => lockLabel(state.value, new Date(props.item.lockAt), props.now))

function submit(): void {
  const h = parseScoreInput(home.value); const a = parseScoreInput(away.value)
  if (!h.ok || !a.ok) { localError.value = (!h.ok ? h.message : !a.ok ? a.message : ''); return }
  localError.value = ''
  emit('save', h.value, a.value)
}
</script>

<template>
  <article class="app-surface p-4" :aria-label="`${item.homeName} contra ${item.awayName}`">
    <div class="flex items-center justify-between text-xs font-medium text-text-muted">
      <span>{{ kickoff }}</span>
      <StatChip v-if="state === 'open'" :label="label" tone="success" />
      <StatChip v-else-if="state === 'locked'" :label="label" :icon="Lock" tone="neutral" />
      <StatChip v-else-if="state === 'live'" :label="label" tone="danger" />
      <StatChip v-else :label="label" tone="neutral" />
    </div>

    <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <p class="truncate text-right text-sm font-semibold text-text">{{ item.homeName }}</p>
      <p class="font-display text-lg font-bold text-text">
        <span v-if="item.result">{{ item.result.home }} - {{ item.result.away }}</span>
        <span v-else class="text-text-faint">vs</span>
      </p>
      <p class="truncate text-sm font-semibold text-text">{{ item.awayName }}</p>
    </div>

    <form v-if="state === 'open' && canPredict" class="mt-3 space-y-2" @submit.prevent="submit">
      <div class="flex items-center justify-center gap-3">
        <label class="sr-only" :for="`ph-${item.matchId}`">Goles de {{ item.homeName }}</label>
        <input :id="`ph-${item.matchId}`" v-model="home" inputmode="numeric" maxlength="2" class="field-surface h-12 w-16 text-center text-lg font-bold" placeholder="–" />
        <span class="text-text-faint" aria-hidden="true">-</span>
        <label class="sr-only" :for="`pa-${item.matchId}`">Goles de {{ item.awayName }}</label>
        <input :id="`pa-${item.matchId}`" v-model="away" inputmode="numeric" maxlength="2" class="field-surface h-12 w-16 text-center text-lg font-bold" placeholder="–" />
      </div>
      <PrimaryButton type="submit" :loading="saving">{{ item.mine ? 'Actualizar pronóstico' : 'Guardar pronóstico' }}</PrimaryButton>
    </form>

    <div v-else-if="item.mine" class="mt-3 flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">
      <span>Tu pronóstico: {{ item.mine.home }} - {{ item.mine.away }}</span>
      <span v-if="item.points != null" class="font-semibold text-primary">+{{ item.points }} pts</span>
    </div>
    <p v-else-if="state !== 'open'" class="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-text-muted">No enviaste pronóstico para este partido.</p>

    <p v-if="localError || message" class="mt-2 text-sm font-medium text-danger" role="alert">{{ localError || message }}</p>
  </article>
</template>
