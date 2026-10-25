<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { usePostSignInNavigation } from '../composables/usePostSignInNavigation'
import { validatePasswordUpdate } from '../lib/auth-validation'

const router = useRouter()
const auth = useAuth()
const { continueAfterSignIn } = usePostSignInNavigation()

const password = ref('')
const confirmPassword = ref('')
const errors = ref<Record<string, string | undefined>>({})
const error = ref('')
const saving = ref(false)

// Cancelar cierra la sesión de recuperación (local): el enlace del correo abre una sesión completa que no debe quedar abierta (FE-09).
async function cancel(): Promise<void> {
  await auth.cancelRecovery()
  await router.replace({ name: 'home' })
}

async function submit(): Promise<void> {
  error.value = ''
  errors.value = validatePasswordUpdate({ password: password.value, confirmPassword: confirmPassword.value })
  if (Object.keys(errors.value).length) return
  saving.value = true
  const result = await auth.updatePassword(password.value)
  saving.value = false
  password.value = ''; confirmPassword.value = ''
  if (result) { error.value = result; return }
  await continueAfterSignIn()
}
</script>

<template>
  <AppShell variant="focus">
    <section class="w-full space-y-6">
      <div class="text-center">
        <h1 class="font-display text-xl font-bold text-text">Crea tu nueva contraseña</h1>
        <p class="mt-1 text-sm text-text-muted">Con ella podrás iniciar sesión con tu correo.</p>
      </div>
      <form class="space-y-4 app-surface-raised p-5" novalidate @submit.prevent="submit">
        <FormField id="new-password" v-model="password" type="password" label="Nueva contraseña" autocomplete="new-password" required hint="Mínimo 8 caracteres, con letras y números." :error="errors.password" />
        <FormField id="confirm-new-password" v-model="confirmPassword" type="password" label="Confirmar contraseña" autocomplete="new-password" required :error="errors.confirmPassword" />
        <PrimaryButton type="submit" :loading="saving">Guardar contraseña</PrimaryButton>
      </form>
      <p v-if="error" class="text-center text-sm font-medium text-danger" role="alert">{{ error }}</p>
      <p class="text-center"><button type="button" class="min-h-11 text-sm font-semibold text-text-muted" @click="cancel">Cancelar</button></p>
    </section>
  </AppShell>
</template>
