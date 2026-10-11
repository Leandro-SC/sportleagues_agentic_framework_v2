<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowRight } from 'lucide-vue-next'
import FormField from './FormField.vue'
import PrimaryButton from './PrimaryButton.vue'
import SecondaryButton from './SecondaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { usePostSignInNavigation } from '../composables/usePostSignInNavigation'
import { peekJoinIntent } from '../lib/join-intent'
import { MAX_NAME_LENGTH, validateEmail, validateSignIn, validateSignUp } from '../lib/auth-validation'

export type AuthMode = 'sign-in' | 'sign-up' | 'forgot'

const props = defineProps<{ mode: AuthMode }>()
const emit = defineEmits<{ 'update:mode': [mode: AuthMode] }>()

const auth = useAuth()
const { continueAfterSignIn } = usePostSignInNavigation()

const fullName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const errors = ref<Record<string, string | undefined>>({})
const error = ref('')
const notice = ref('')
const submitting = ref(false)
const signingGoogle = ref(false)

// Nunca se conservan credenciales al cambiar de modo, y los mensajes se reinician.
watch(() => props.mode, () => {
  password.value = ''; confirmPassword.value = ''
  errors.value = {}; error.value = ''; notice.value = ''
})

async function submit(): Promise<void> {
  error.value = ''; notice.value = ''
  submitting.value = true
  try {
    if (props.mode === 'sign-up') await signUp()
    else if (props.mode === 'sign-in') await signIn()
    else await forgot()
  } finally {
    submitting.value = false
  }
}

function pendingInviteHint(): string {
  return peekJoinIntent() ? 'Tu código de invitación se conserva 24 horas en este navegador; si lo pierdes, ingrésalo en Ligas → Unirme con código.' : ''
}

async function signUp(): Promise<void> {
  errors.value = validateSignUp({ fullName: fullName.value, email: email.value, password: password.value, confirmPassword: confirmPassword.value })
  if (Object.keys(errors.value).length) return
  const result = await auth.signUpWithPassword({ fullName: fullName.value, email: email.value, password: password.value })
  password.value = ''; confirmPassword.value = ''
  if (result.error) { error.value = result.error; return }
  if (result.signedIn) { await continueAfterSignIn(); return }
  notice.value = [result.notice, pendingInviteHint()].filter(Boolean).join(' ')
}

async function signIn(): Promise<void> {
  errors.value = validateSignIn({ email: email.value, password: password.value })
  if (Object.keys(errors.value).length) return
  const result = await auth.signInWithPassword(email.value, password.value)
  password.value = ''
  if (result) { error.value = result; return }
  await continueAfterSignIn()
}

async function forgot(): Promise<void> {
  const invalid = validateEmail(email.value)
  errors.value = invalid ? { email: invalid } : {}
  if (invalid) return
  const result = await auth.requestPasswordReset(email.value)
  if (result.error) error.value = result.error; else notice.value = result.notice
}

async function google(): Promise<void> {
  error.value = ''; notice.value = ''; signingGoogle.value = true
  const result = await auth.signInWithGoogle()
  signingGoogle.value = false
  if (result) error.value = result
}
</script>

<template>
  <div class="space-y-3 app-surface-raised p-5">
    <div>
      <p class="section-kicker">{{ mode === 'sign-in' ? 'Bienvenido' : mode === 'sign-up' ? 'Empieza a competir' : 'Recuperar acceso' }}</p>
      <h2 class="mt-1 font-display text-xl font-bold text-text">
        {{ mode === 'sign-in' ? 'Inicia sesión' : mode === 'sign-up' ? 'Crea tu cuenta' : 'Recupera tu contraseña' }}
      </h2>
      <p v-if="mode === 'forgot'" class="mt-1 text-sm text-text-muted">Te enviaremos un enlace para crear una nueva contraseña.</p>
    </div>

    <form class="space-y-3" novalidate @submit.prevent="submit">
      <FormField
        v-if="mode === 'sign-up'"
        id="full-name"
        v-model="fullName"
        label="Nombre completo"
        autocomplete="name"
        required
        :maxlength="MAX_NAME_LENGTH"
        placeholder="Como quieres que te vean"
        :error="errors.fullName"
      />
      <FormField id="email" v-model="email" type="email" label="Correo electrónico" autocomplete="email" required placeholder="tú@correo.com" :error="errors.email" />
      <FormField
        v-if="mode !== 'forgot'"
        id="password"
        v-model="password"
        type="password"
        label="Contraseña"
        :autocomplete="mode === 'sign-up' ? 'new-password' : 'current-password'"
        required
        :hint="mode === 'sign-up' ? 'Mínimo 8 caracteres, con letras y números.' : undefined"
        :error="errors.password"
      />
      <FormField
        v-if="mode === 'sign-up'"
        id="confirm-password"
        v-model="confirmPassword"
        type="password"
        label="Confirmar contraseña"
        autocomplete="new-password"
        required
        :error="errors.confirmPassword"
      />

      <button v-if="mode === 'sign-in'" type="button" class="press-scale min-h-11 text-sm font-semibold text-primary" @click="emit('update:mode', 'forgot')">
        ¿Olvidaste tu contraseña?
      </button>

      <PrimaryButton type="submit" :loading="submitting">
        {{ mode === 'sign-in' ? 'Iniciar sesión' : mode === 'sign-up' ? 'Crear cuenta' : 'Enviar enlace' }}
        <ArrowRight class="h-4 w-4" />
      </PrimaryButton>
    </form>

    <template v-if="mode !== 'forgot'">
      <div class="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-text-faint">
        <span class="h-px flex-1 bg-border" />o<span class="h-px flex-1 bg-border" />
      </div>
      <SecondaryButton :loading="signingGoogle" @click="google">Continuar con Google</SecondaryButton>
    </template>

    <p class="pt-1 text-center text-sm text-text-muted">
      <template v-if="mode === 'sign-in'">¿No tienes cuenta? <button type="button" class="min-h-11 font-semibold text-primary" @click="emit('update:mode', 'sign-up')">Crear cuenta</button></template>
      <template v-else-if="mode === 'sign-up'">¿Ya tienes cuenta? <button type="button" class="min-h-11 font-semibold text-primary" @click="emit('update:mode', 'sign-in')">Iniciar sesión</button></template>
      <button v-else type="button" class="min-h-11 font-semibold text-primary" @click="emit('update:mode', 'sign-in')">Volver a iniciar sesión</button>
    </p>

    <p v-if="error" class="rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger" role="alert">{{ error }}</p>
    <p v-if="notice" class="rounded-xl bg-primary-100 p-3 text-sm font-medium text-primary" role="status">{{ notice }}</p>
  </div>
</template>
