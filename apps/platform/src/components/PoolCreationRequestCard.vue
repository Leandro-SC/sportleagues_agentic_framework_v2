<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CirclePlus, Clock3, LoaderCircle } from 'lucide-vue-next'
import BottomSheet from './BottomSheet.vue'
import PrimaryButton from './PrimaryButton.vue'
import SecondaryButton from './SecondaryButton.vue'
import { useOnlineStatus } from '../composables/useOnlineStatus'
import { usePoolCreationRequest } from '../composables/usePoolCreationRequest'
import { POOL_REQUEST_NOTE_MAX, POOL_REQUEST_REVIEW_NOTICE, POOL_REQUEST_UNAVAILABLE_MESSAGE, STATUS_COPY, normalizePoolRequestNote } from '../lib/pool-creation-request'

// «Crear mi propia quiniela» en Mi perfil. Solo se monta para usuarios SIN acceso admin (decide
// ProfileView con useTenantAdminAccess). Envía una SOLICITUD con nota opcional; nunca eleva permisos.
const flow = usePoolCreationRequest()
const { online } = useOnlineStatus()
const sheetOpen = ref(false)
const note = ref('')
const confirmingCancel = ref(false)

const noteCount = computed(() => Array.from(note.value).length)
const noteError = computed(() => normalizePoolRequestNote(note.value).error)
const copy = computed(() => (flow.request.value ? STATUS_COPY[flow.request.value.status] : null))
const requestedAt = computed(() => {
  const iso = flow.request.value?.requested_at
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(date)
})

onMounted(() => { void flow.load() })

async function send(): Promise<void> {
  const accepted = await flow.submit(note.value)
  if (accepted) note.value = ''
  if (accepted || flow.availability.value === 'unavailable' || flow.alreadyOrganizer.value) sheetOpen.value = false
}
async function cancelRequest(): Promise<void> {
  await flow.cancel()
  confirmingCancel.value = false
}
</script>

<template>
  <section class="app-surface space-y-3 p-4" aria-labelledby="pool-request-title" data-test="pool-request-card">
    <div class="flex items-start gap-3">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary"><CirclePlus class="h-5 w-5" aria-hidden="true" /></span>
      <div class="min-w-0">
        <h2 id="pool-request-title" class="font-display text-base font-bold text-text">Crear mi propia quiniela</h2>
        <p class="mt-0.5 text-sm text-text-muted">Pide organizar tu propia quiniela. {{ POOL_REQUEST_REVIEW_NOTICE }}</p>
      </div>
    </div>

    <p v-if="!online" class="rounded-xl bg-warn-100 p-3 text-sm font-medium text-warn" role="status" data-test="offline-notice">Sin conexión: no podrás enviar ni cancelar solicitudes hasta volver a conectarte.</p>

    <p v-if="flow.loading.value" class="flex items-center gap-2 text-sm text-text-muted" role="status"><LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />Comprobando tu solicitud…</p>

    <template v-else-if="flow.availability.value === 'unavailable'">
      <p class="rounded-xl bg-surface-2 p-3 text-sm text-text-muted" role="status" data-test="unavailable">{{ POOL_REQUEST_UNAVAILABLE_MESSAGE }}<template v-if="flow.unavailableReason.value === 'network'">. Revisa tu conexión e inténtalo de nuevo.</template></p>
      <PrimaryButton disabled>Crear mi propia quiniela</PrimaryButton>
      <SecondaryButton v-if="flow.unavailableReason.value === 'network'" @click="flow.load()">Reintentar</SecondaryButton>
    </template>

    <template v-else>
      <div v-if="copy" class="space-y-1 rounded-xl border border-border p-3" data-test="request-status">
        <p class="flex items-center gap-2 text-sm font-semibold text-text"><Clock3 v-if="flow.hasPending.value" class="h-4 w-4 text-warn" aria-hidden="true" />{{ copy.label }}<span v-if="requestedAt" class="font-normal text-text-muted"> · {{ requestedAt }}</span></p>
        <p class="text-sm text-text-muted">{{ copy.detail }}</p>
      </div>

      <p v-if="flow.alreadyOrganizer.value" class="rounded-xl bg-surface-2 p-3 text-sm text-text-muted" role="status">Ya administras una organización. Vuelve a Inicio para entrar en el Modo organizador.</p>

      <template v-if="flow.hasPending.value">
        <template v-if="!confirmingCancel">
          <SecondaryButton :disabled="!online" @click="confirmingCancel = true">Cancelar solicitud</SecondaryButton>
        </template>
        <div v-else class="space-y-2" data-test="cancel-confirm">
          <p class="text-sm text-text">¿Cancelar tu solicitud pendiente?</p>
          <div class="grid grid-cols-2 gap-2">
            <SecondaryButton :disabled="flow.cancelling.value" @click="confirmingCancel = false">Mantener</SecondaryButton>
            <SecondaryButton tone="danger" :loading="flow.cancelling.value" :disabled="!online" @click="cancelRequest">Sí, cancelar</SecondaryButton>
          </div>
        </div>
      </template>
      <PrimaryButton v-else :disabled="!flow.canSubmit.value || !online" @click="flow.error.value = ''; sheetOpen = true">{{ flow.request.value && flow.request.value.status !== 'approved' ? 'Enviar una nueva solicitud' : 'Crear mi propia quiniela' }}</PrimaryButton>

      <p v-if="flow.notice.value" class="text-sm font-medium text-primary" role="status">{{ flow.notice.value }}</p>
      <p v-if="flow.error.value && !sheetOpen" class="text-sm font-medium text-danger" role="alert">{{ flow.error.value }}</p>
    </template>

    <BottomSheet v-model:open="sheetOpen" title="Crear mi propia quiniela">
      <form class="space-y-3" @submit.prevent="send">
        <p class="text-sm text-text-muted">{{ POOL_REQUEST_REVIEW_NOTICE }}</p>
        <div class="space-y-1.5">
          <label for="pool-request-note" class="block text-sm font-medium text-text-muted">Nota para el operador (opcional)</label>
          <textarea id="pool-request-note" v-model="note" rows="4" :maxlength="POOL_REQUEST_NOTE_MAX" class="field-surface w-full resize-none px-4 py-3 text-[15px] outline-none focus:border-primary" placeholder="Cuéntanos qué quiniela quieres organizar" aria-describedby="pool-request-count" />
          <p id="pool-request-count" class="text-right text-xs text-text-muted">{{ noteCount }}/{{ POOL_REQUEST_NOTE_MAX }}</p>
          <p v-if="noteError" class="text-sm font-medium text-danger" role="alert">{{ noteError }}</p>
        </div>
        <p v-if="flow.error.value" class="text-sm font-medium text-danger" role="alert">{{ flow.error.value }}</p>
        <PrimaryButton type="submit" :loading="flow.submitting.value" :disabled="Boolean(noteError) || !online">Enviar solicitud</PrimaryButton>
      </form>
    </BottomSheet>
  </section>
</template>
