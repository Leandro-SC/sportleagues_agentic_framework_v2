<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { normalizeJoinCode } from '../lib/join-intent'
import BottomSheet from './BottomSheet.vue'
import FormField from './FormField.vue'
import PrimaryButton from './PrimaryButton.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const router = useRouter()
const code = ref('')
const error = ref('')

function submit(): void {
  const normalized = normalizeJoinCode(code.value)
  if (!normalized) {
    error.value = 'Ingresa un código válido de seis caracteres.'
    return
  }
  error.value = ''
  emit('update:open', false)
  void router.push({ name: 'join', params: { code: normalized } })
}

function onUpdateOpen(value: boolean): void {
  if (!value) {
    code.value = ''
    error.value = ''
  }
  emit('update:open', value)
}
void props
</script>

<template>
  <BottomSheet :open="open" title="Unirme con código" @update:open="onUpdateOpen">
    <p class="mb-4 text-sm text-ink-500">Pide el código de invitación al administrador de la quiniela.</p>
    <form class="space-y-4" @submit.prevent="submit">
      <FormField
        id="sheet-join-code"
        v-model="code"
        label="Código de invitación"
        placeholder="AB12CD"
        :maxlength="6"
        autocomplete="off"
        input-class="text-center font-display text-lg tracking-[0.3em] uppercase"
        :error="error"
      />
      <PrimaryButton type="submit">Continuar</PrimaryButton>
    </form>
  </BottomSheet>
</template>
