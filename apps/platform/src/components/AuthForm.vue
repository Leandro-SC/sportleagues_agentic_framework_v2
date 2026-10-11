<script setup lang="ts">
import { ref, watch } from 'vue'
import { ArrowRight, Check, Lock, Mail, UserRound, UserRoundPlus } from 'lucide-vue-next'
import AuthField from './AuthField.vue'
import PrimaryButton from './PrimaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { usePostSignInNavigation } from '../composables/usePostSignInNavigation'
import { peekJoinIntent } from '../lib/join-intent'
import { getRememberSession, setRememberSession } from '../lib/session-storage'
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
const remember = ref(getRememberSession())

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
  setRememberSession(remember.value)
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
  setRememberSession(remember.value)
  const result = await auth.signInWithGoogle()
  signingGoogle.value = false
  if (result) error.value = result
}
</script>

<template>
  <div class="space-y-2.5">
    <div class="rounded-3xl border border-secondary/20 bg-surface/90 p-4 shadow-md backdrop-blur-sm">
      <h2 class="font-display text-2xl font-extrabold leading-tight tracking-tight text-text">
        {{ mode === 'sign-in' ? 'Bienvenido' : mode === 'sign-up' ? 'Crea tu cuenta' : 'Recupera tu contraseña' }}
      </h2>
      <p class="mt-0.5 text-sm text-secondary [@media(max-height:700px)]:hidden">
        {{ mode === 'sign-in' ? 'Inicia sesión para continuar' : mode === 'sign-up' ? 'Usa tu correo o Google para empezar' : 'Te enviaremos un enlace para crear una nueva contraseña.' }}
      </p>

      <form class="mt-3 space-y-2.5" novalidate @submit.prevent="submit">
        <AuthField
          v-if="mode === 'sign-up'"
          id="full-name"
          v-model="fullName"
          :icon="UserRound"
          placeholder="Nombre completo"
          autocomplete="name"
          required
          :maxlength="MAX_NAME_LENGTH"
          :error="errors.fullName"
        />
        <AuthField id="email" v-model="email" :icon="Mail" type="email" placeholder="Correo electrónico" autocomplete="email" required :error="errors.email" />
        <AuthField
          v-if="mode !== 'forgot'"
          id="password"
          v-model="password"
          :icon="Lock"
          type="password"
          :placeholder="mode === 'sign-up' ? 'Contraseña (mínimo 8)' : 'Contraseña'"
          :autocomplete="mode === 'sign-up' ? 'new-password' : 'current-password'"
          required
          :error="errors.password"
        />
        <AuthField
          v-if="mode === 'sign-up'"
          id="confirm-password"
          v-model="confirmPassword"
          :icon="Lock"
          type="password"
          placeholder="Confirmar contraseña"
          autocomplete="new-password"
          required
          :error="errors.confirmPassword"
        />

        <div v-if="mode === 'sign-in'" class="flex flex-wrap items-center justify-between gap-x-2">
          <label class="flex min-h-11 cursor-pointer items-center gap-2 whitespace-nowrap text-[13px] text-text-muted">
            <input v-model="remember" type="checkbox" class="peer sr-only" />
            <span class="flex h-5 w-5 items-center justify-center rounded-md border border-secondary/40 bg-canvas/40 text-canvas transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary" aria-hidden="true">
              <Check v-if="remember" class="h-3.5 w-3.5" stroke-width="3" />
            </span>
            Recordar mi cuenta
          </label>
          <button type="button" class="press-scale min-h-11 whitespace-nowrap text-xs font-semibold text-primary" @click="emit('update:mode', 'forgot')">¿Olvidaste tu contraseña?</button>
        </div>

        <PrimaryButton type="submit" :loading="submitting" class="py-3 text-base">
          {{ mode === 'sign-in' ? 'Iniciar sesión' : mode === 'sign-up' ? 'Crear cuenta' : 'Enviar enlace' }}
          <ArrowRight class="h-5 w-5" />
        </PrimaryButton>
      </form>

      <template v-if="mode !== 'forgot'">
        <div class="my-2.5 flex items-center gap-4 text-sm font-medium text-text-muted">
          <span class="h-px flex-1 bg-border-strong" />o<span class="h-px flex-1 bg-border-strong" />
        </div>
        <button
          type="button"
          class="press-scale flex min-h-12 w-full items-center justify-center gap-3 rounded-pill border border-text/40 bg-transparent px-5 text-base font-bold text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          :disabled="signingGoogle"
          @click="google"
        >
          <svg class="h-6 w-6" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
            <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
            <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.9 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
          </svg>
          Continuar con Google
        </button>
      </template>

      <p v-if="error" class="mt-3 rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger" role="alert">{{ error }}</p>
      <p v-if="notice" class="mt-3 rounded-xl bg-primary-100 p-3 text-sm font-medium text-primary" role="status">{{ notice }}</p>
    </div>

    <div class="flex items-center gap-3 rounded-3xl border border-secondary/20 bg-surface/90 p-2.5 backdrop-blur-sm">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary" aria-hidden="true">
        <UserRoundPlus class="h-5 w-5" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate font-display text-[15px] font-bold text-text">{{ mode === 'sign-in' ? '¿No tienes cuenta?' : mode === 'sign-up' ? '¿Ya tienes cuenta?' : '¿Ya la recordaste?' }}</p>
        <p class="text-[13px] leading-snug text-secondary [@media(max-height:700px)]:hidden">{{ mode === 'sign-in' ? 'Crea tu cuenta en segundos' : 'Inicia sesión para continuar' }}</p>
      </div>
      <button
        type="button"
        class="press-scale min-h-11 shrink-0 rounded-pill border border-primary px-3.5 text-[13px] font-bold text-primary transition-colors hover:bg-primary-100"
        @click="emit('update:mode', mode === 'sign-in' ? 'sign-up' : 'sign-in')"
      >
        {{ mode === 'sign-in' ? 'Crear cuenta' : mode === 'sign-up' ? 'Iniciar sesión' : 'Volver a iniciar sesión' }}
      </button>
    </div>
  </div>
</template>
