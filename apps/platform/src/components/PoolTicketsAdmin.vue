<script setup lang="ts">
import { ref, watch } from 'vue'
import { Ticket } from 'lucide-vue-next'
import PrimaryButton from './PrimaryButton.vue'
import SecondaryButton from './SecondaryButton.vue'
import { usePoolTicketsAdmin } from '../composables/usePoolTicketsAdmin'

// Tarjeta de administración de tickets dentro de la quiniela seleccionada. Habilitar tickets es irreversible y solo es posible antes del
// primer pronóstico; el servidor lo impone. No hay precios ni cobros en esta etapa.
const props = defineProps<{ poolId: string; ticketingMode: 'none' | 'tickets'; archived: boolean }>()
const emit = defineEmits<{ changed: [] }>()
const admin = usePoolTicketsAdmin()
const confirmed = ref(false)
const defaultMax = ref('1')
const drafts = ref<Record<string, string>>({})
const message = ref('')
const failure = ref('')

watch(() => [props.poolId, props.ticketingMode] as const, ([id, mode]) => { confirmed.value = false; message.value = ''; failure.value = ''; if (mode === 'tickets') void admin.load(id) }, { immediate: true })
watch(() => admin.rounds.value, (list) => { drafts.value = Object.fromEntries(list.map((r) => [r.roundId, String(r.max)])) })

async function enable(): Promise<void> {
  const max = Number(defaultMax.value)
  if (!Number.isInteger(max) || max < 1 || max > 20) { failure.value = 'El máximo por jornada debe estar entre 1 y 20.'; return }
  const result = await admin.enable(props.poolId, max)
  failure.value = result ?? ''
  if (!result) { message.value = 'Tickets habilitados.'; emit('changed') }
}
async function save(roundId: string): Promise<void> {
  const max = Number(drafts.value[roundId])
  if (!Number.isInteger(max) || max < 1 || max > 20) { failure.value = 'El máximo por jornada debe estar entre 1 y 20.'; return }
  const result = await admin.setLimit(props.poolId, roundId, max)
  failure.value = result ?? ''
  if (!result) message.value = 'Máximo actualizado.'
}
</script>

<template>
  <section class="app-surface space-y-3 p-4" aria-label="Tickets de la quiniela">
    <div class="flex items-center gap-2"><Ticket class="h-5 w-5 text-primary" aria-hidden="true" /><h2 class="font-display font-bold text-text">Tickets</h2></div>

    <template v-if="ticketingMode === 'none'">
      <p class="text-sm text-text-muted">Con tickets, cada participante emite una o varias jugadas por jornada y solo compite la mejor. No hay cobros ni precios. <strong class="text-text">Se habilitan una sola vez y solo antes del primer pronóstico.</strong></p>
      <p v-if="archived" class="text-sm text-warn">Una quiniela archivada no puede habilitar tickets.</p>
      <template v-else>
        <label class="block text-sm font-medium text-text-muted">Máximo de tickets por participante y jornada
          <input v-model="defaultMax" type="number" min="1" max="20" class="field-surface mt-1.5 w-full px-3 py-3 text-sm" />
        </label>
        <label class="flex items-start gap-2 text-sm text-text-muted"><input v-model="confirmed" type="checkbox" class="mt-0.5 h-4 w-4 rounded accent-primary" />Entiendo que esta acción no se puede revertir.</label>
        <PrimaryButton :disabled="!confirmed" :loading="admin.saving.value" @click="enable">Habilitar tickets</PrimaryButton>
      </template>
    </template>

    <template v-else>
      <p class="text-sm text-text-muted">Tickets habilitados. Define el máximo por jornada; solo se puede cambiar mientras la venta esté abierta (antes del primer partido de la jornada). Las jornadas nuevas deben configurarse aquí para ser vendibles.</p>
      <p v-if="admin.loading.value" class="text-sm text-text-muted" role="status">Cargando jornadas…</p>
      <p v-else-if="admin.error.value" class="text-sm text-danger" role="alert">{{ admin.error.value }}</p>
      <p v-else-if="!admin.rounds.value.length" class="rounded-xl bg-surface-2 p-3 text-sm text-text-muted">Aún no hay jornadas vendibles: añade partidos a la quiniela desde la parrilla.</p>
      <ul v-else class="space-y-2">
        <li v-for="round in admin.rounds.value" :key="round.roundId" class="flex items-end gap-2">
          <label class="block flex-1 text-sm font-medium text-text-muted">{{ round.roundName }}
            <input v-model="drafts[round.roundId]" type="number" min="1" max="20" class="field-surface mt-1.5 w-full px-3 py-3 text-sm" />
          </label>
          <SecondaryButton :full-width="false" :loading="admin.saving.value" @click="save(round.roundId)">Guardar</SecondaryButton>
        </li>
      </ul>
    </template>

    <p v-if="failure" class="rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger" role="alert">{{ failure }}</p>
    <p v-if="message" class="rounded-xl bg-primary-100 p-3 text-sm font-medium text-primary" role="status">{{ message }}</p>
  </section>
</template>
