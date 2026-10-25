<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { LEGAL_VERSION } from '../lib/legal-content'

const auth = useAuth()
const router = useRouter()
const accepted = ref(false)
const saving = ref(false)
const error = ref('')
async function submit(): Promise<void> {
  if (!accepted.value) return
  saving.value = true; error.value = ''
  const message = await auth.acceptLegalDocuments(LEGAL_VERSION, LEGAL_VERSION)
  saving.value = false
  if (message) { error.value = message; return }
  await router.replace(auth.state.profile ? { name: 'home' } : { name: 'onboarding' })
}
</script>

<template>
  <AppShell variant="focus"><section class="mx-auto w-full max-w-lg space-y-5 app-surface-raised p-5"><div><h1 class="font-display text-xl font-bold text-text">Antes de continuar</h1><p class="mt-1 text-sm text-text-muted">Lee y acepta los documentos que regulan el uso de SportLeagues.</p></div><label class="flex items-start gap-3 text-sm text-text"><input v-model="accepted" type="checkbox" class="mt-1 h-4 w-4 accent-primary" /><span>He leído y acepto los <RouterLink :to="{ name: 'terms' }" class="font-semibold text-primary underline">Términos de uso</RouterLink> y la <RouterLink :to="{ name: 'privacy' }" class="font-semibold text-primary underline">Política de privacidad</RouterLink>, versión {{ LEGAL_VERSION }}.</span></label><PrimaryButton :disabled="!accepted" :loading="saving" @click="submit">Aceptar y continuar</PrimaryButton><p v-if="error" class="text-sm font-medium text-danger" role="alert">{{ error }}</p></section></AppShell>
</template>
