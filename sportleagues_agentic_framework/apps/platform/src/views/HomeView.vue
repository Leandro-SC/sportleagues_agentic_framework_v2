<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { KeyRound, ListChecks, Sparkles, Target, Trophy } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import EmptyState from '../components/EmptyState.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import StatChip from '../components/StatChip.vue'
import { useAuth } from '../composables/useAuth'
import { normalizeJoinCode } from '../lib/join-intent'

const router = useRouter()
const auth = useAuth()

const joinOpen = ref(false)
const code = ref('')
const codeError = ref('')
const email = ref('')
const notice = ref('')
const error = ref('')
const sendingMagic = ref(false)
const signingGoogle = ref(false)

function goToJoin(): void {
  const normalized = normalizeJoinCode(code.value)
  if (!normalized) { codeError.value = 'Ingresa un código válido de seis caracteres.'; return }
  codeError.value = ''
  void router.push({ name: 'join', params: { code: normalized } })
}

async function magicLink(): Promise<void> {
  error.value = ''; notice.value = ''; sendingMagic.value = true
  const result = await auth.sendMagicLink(email.value)
  sendingMagic.value = false
  if (result) error.value = result; else notice.value = 'Revisa tu correo para continuar.'
}

async function google(): Promise<void> {
  error.value = ''; signingGoogle.value = true
  const result = await auth.signInWithGoogle()
  signingGoogle.value = false
  if (result) error.value = result
}
</script>

<template>
  <AppShell
    v-model:join-open="joinOpen"
    :variant="auth.isAuthenticated.value ? 'app' : 'guest'"
    active="home"
    title="Inicio"
    :user-name="auth.state.profile?.display_name"
  >
    <section v-if="!auth.isAuthenticated.value" class="space-y-7 pb-4 pt-2">
      <div>
        <h1 class="font-display text-[2rem] font-extrabold leading-tight text-ink-950">Tu quiniela,<br />sin hojas de cálculo.</h1>
        <p class="mt-3 text-[15px] text-ink-600">Compite con tus amigos, predice resultados y sube en la tabla de tu quiniela favorita.</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <StatChip label="Multi-tenant seguro" :icon="Trophy" tone="brand" />
          <StatChip label="Elo + Poisson" :icon="Sparkles" tone="success" />
        </div>
      </div>

      <div class="space-y-3 rounded-2xl border border-mist-200 bg-white p-5 shadow-md">
        <h2 class="font-display text-base font-bold text-ink-950">Iniciar sesión</h2>
        <form class="space-y-3" @submit.prevent="magicLink">
          <FormField id="email" v-model="email" type="email" label="Correo electrónico" autocomplete="email" required placeholder="tú@correo.com" />
          <PrimaryButton type="submit" :loading="sendingMagic">Enviar magic link</PrimaryButton>
        </form>
        <div class="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-mist-400">
          <span class="h-px flex-1 bg-mist-200" />o<span class="h-px flex-1 bg-mist-200" />
        </div>
        <SecondaryButton :loading="signingGoogle" @click="google">Continuar con Google</SecondaryButton>
      </div>

      <div class="space-y-3 rounded-2xl border border-mist-200 bg-white p-5 shadow-sm">
        <h2 class="flex items-center gap-2 font-display text-base font-bold text-ink-950"><KeyRound class="h-4 w-4 text-brand-600" />¿Tienes un código de invitación?</h2>
        <form class="flex items-start gap-2" @submit.prevent="goToJoin">
          <div class="flex-1">
            <FormField
              id="join-code"
              v-model="code"
              label="Código de unión"
              placeholder="AB12CD"
              :maxlength="6"
              autocomplete="off"
              input-class="text-center font-display tracking-[0.3em] uppercase"
              :error="codeError"
            />
          </div>
          <PrimaryButton type="submit" :full-width="false" class="mt-6">Unirme</PrimaryButton>
        </form>
      </div>

      <p v-if="error" class="rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger-600" role="alert">{{ error }}</p>
      <p v-if="notice" class="rounded-xl bg-success-100 p-3 text-sm font-medium text-success-600">{{ notice }}</p>
    </section>

    <section v-else class="space-y-6 pb-4 pt-2">
      <div v-if="!auth.state.profile" class="rounded-2xl border border-brand-300 bg-brand-100/60 p-5">
        <h1 class="font-display text-lg font-bold text-ink-950">Un último paso</h1>
        <p class="mt-1 text-sm text-ink-600">Completa tu perfil para acceder a tus quinielas.</p>
        <PrimaryButton class="mt-4" @click="router.push({ name: 'onboarding' })">Completar perfil</PrimaryButton>
      </div>

      <template v-else>
        <div>
          <h1 class="font-display text-xl font-bold text-ink-950">Hola, {{ auth.state.profile.display_name }}</h1>
          <p class="text-sm text-ink-500">Este es tu resumen de actividad.</p>
        </div>

        <EmptyState :icon="Trophy" title="Aún no perteneces a ninguna quiniela" description="Únete con el código que te compartió el administrador para empezar a predecir y sumar puntos.">
          <template #action>
            <PrimaryButton @click="joinOpen = true">
              <KeyRound class="h-4 w-4" />
              Unirme con código
            </PrimaryButton>
          </template>
        </EmptyState>

        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-xl border border-mist-200 bg-white p-3 text-center">
            <KeyRound class="mx-auto h-5 w-5 text-brand-600" />
            <p class="mt-2 text-xs font-semibold text-ink-900">1. Únete</p>
          </div>
          <div class="rounded-xl border border-mist-200 bg-white p-3 text-center">
            <Target class="mx-auto h-5 w-5 text-brand-600" />
            <p class="mt-2 text-xs font-semibold text-ink-900">2. Predice</p>
          </div>
          <div class="rounded-xl border border-mist-200 bg-white p-3 text-center">
            <ListChecks class="mx-auto h-5 w-5 text-brand-600" />
            <p class="mt-2 text-xs font-semibold text-ink-900">3. Compite</p>
          </div>
        </div>
      </template>
    </section>
  </AppShell>
</template>
