<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, KeyRound, ListChecks, Sparkles, Target, Trophy } from 'lucide-vue-next'
import coverBackground from '../assets/backgrounds/fondo_app_tablo.png'
import coverLogo from '../assets/branding/logo_app_tablo.png'
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
const authPanel = ref(false)
const authMode = ref<'sign-in' | 'sign-up'>('sign-in')
const coverIcons = [Trophy, Target, Sparkles, ListChecks, KeyRound]

const initials = computed(() => {
  const name = auth.state.profile?.display_name?.trim()
  if (!name) return '?'
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
})

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

function openAuth(mode: 'sign-in' | 'sign-up'): void {
  authMode.value = mode
  authPanel.value = true
  error.value = ''
  notice.value = ''
}
</script>

<template>
  <AppShell
    v-model:join-open="joinOpen"
    :variant="auth.isAuthenticated.value ? 'app' : authPanel ? 'guest' : 'focus'"
    active="home"
    title="Inicio"
    :user-name="auth.state.profile?.display_name"
  >
    <section v-if="!auth.isAuthenticated.value && !authPanel" class="relative -mx-5 flex min-h-[100dvh] w-[calc(100%+2.5rem)] flex-col overflow-hidden bg-canvas px-5 pb-7 pt-5 text-center">
      <img :src="coverBackground" alt="" class="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <div class="pointer-events-none absolute inset-0 bg-linear-to-b from-canvas/30 via-canvas/10 to-canvas/85" />
      <div class="relative flex flex-1 flex-col">
        <img :src="coverLogo" alt="Tablo" class="mx-auto mt-[5dvh] w-48 drop-shadow-[0_8px_24px_rgba(0,0,0,0.65)]" />
        <p class="mx-auto mt-2 max-w-44 font-display text-base font-bold leading-tight text-text">Tu pasión,<br />en cada partido</p>
        <div class="mt-5 flex items-center justify-center gap-2" aria-label="Deportes disponibles">
          <span v-for="(icon, index) in coverIcons" :key="index" class="flex h-8 w-8 items-center justify-center rounded-full border border-text/20 bg-canvas/45 text-text backdrop-blur-sm">
            <component :is="icon" class="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
        <div class="flex-1" />
        <div class="space-y-3">
          <button type="button" class="press-scale flex w-full items-center justify-center gap-3 rounded-pill bg-primary px-5 py-4 text-[15px] font-bold text-canvas shadow-glow-primary" @click="openAuth('sign-in')">
            <span>Iniciar sesión</span><ArrowRight class="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" class="press-scale w-full rounded-pill border border-primary bg-canvas/35 px-5 py-4 text-[15px] font-bold text-text backdrop-blur-sm" @click="openAuth('sign-up')">Crear cuenta</button>
        </div>
        <p class="mt-7 text-xs font-medium text-text/85">Juega <span class="mx-2 text-primary">•</span> Compite <span class="mx-2 text-primary">•</span> Conecta</p>
      </div>
    </section>

    <section v-else-if="!auth.isAuthenticated.value" class="space-y-5 pb-4 pt-2">
      <button type="button" class="press-scale inline-flex items-center gap-2 text-sm font-semibold text-text-muted hover:text-text" @click="authPanel = false"><ArrowLeft class="h-4 w-4" />Volver</button>
      <div class="stadium-hero relative -mx-5 overflow-hidden rounded-b-3xl border-b border-secondary/20 px-5 pb-9 pt-8 text-center shadow-md">
        <span class="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-canvas shadow-glow-primary">
          <Trophy class="h-10 w-10" />
        </span>
        <p class="section-kicker mt-6">Juega · Compite · Conecta</p>
        <h1 class="mt-2 font-display text-4xl font-extrabold leading-none tracking-tight text-text">Sport<span class="text-primary">Leagues</span></h1>
        <p class="mt-3 text-sm text-text-muted">Tu pasión, en cada partido.</p>
        <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
          <StatChip label="Multi-tenant seguro" :icon="Trophy" tone="brand" />
          <StatChip label="Elo + Poisson" :icon="Sparkles" tone="success" />
        </div>
      </div>

      <div class="space-y-3 app-surface-raised p-5">
        <div>
          <p class="section-kicker">{{ authMode === 'sign-in' ? 'Bienvenido' : 'Empieza a competir' }}</p>
          <h2 class="mt-1 font-display text-xl font-bold text-text">{{ authMode === 'sign-in' ? 'Inicia sesión' : 'Crea tu cuenta' }}</h2>
          <p class="mt-1 text-sm text-text-muted">{{ authMode === 'sign-in' ? 'Recibe un acceso seguro en tu correo.' : 'Usa tu correo o Google para crearla.' }}</p>
        </div>
        <form class="space-y-3" @submit.prevent="magicLink">
          <FormField id="email" v-model="email" type="email" label="Correo electrónico" autocomplete="email" required placeholder="tú@correo.com" />
          <PrimaryButton type="submit" :loading="sendingMagic">Enviar magic link <ArrowRight class="h-4 w-4" /></PrimaryButton>
        </form>
        <div class="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-text-faint">
          <span class="h-px flex-1 bg-border" />o<span class="h-px flex-1 bg-border" />
        </div>
        <SecondaryButton :loading="signingGoogle" @click="google">Continuar con Google</SecondaryButton>
      </div>

      <div class="space-y-3 app-surface p-5">
        <h2 class="flex items-center gap-2 font-display text-base font-bold text-text"><KeyRound class="h-4 w-4 text-primary" />¿Tienes un código de invitación?</h2>
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

      <p v-if="error" class="rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger" role="alert">{{ error }}</p>
      <p v-if="notice" class="rounded-xl bg-primary-100 p-3 text-sm font-medium text-primary">{{ notice }}</p>
    </section>

    <section v-else class="space-y-6 pb-4 pt-2">
      <div v-if="!auth.state.profile" class="rounded-2xl border border-primary/40 bg-primary-100/50 p-5">
        <h1 class="font-display text-lg font-bold text-text">Un último paso</h1>
        <p class="mt-1 text-sm text-text-muted">Completa tu perfil para acceder a tus quinielas.</p>
        <PrimaryButton class="mt-4" @click="router.push({ name: 'onboarding' })">Completar perfil</PrimaryButton>
      </div>

      <template v-else>
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="section-kicker">Inicio</p>
            <h1 class="font-display text-xl font-bold text-text">Hola, {{ auth.state.profile.display_name }} 👋</h1>
            <p class="text-sm text-text-muted">El deporte nos une.</p>
          </div>
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 font-display text-sm font-bold text-text ring-1 ring-primary/40">{{ initials }}</span>
        </div>

        <div class="stadium-hero overflow-hidden rounded-3xl border border-secondary/25 p-5 shadow-md">
          <span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-canvas shadow-glow-primary"><Trophy class="h-5 w-5" /></span>
          <p class="section-kicker mt-5">Tu próxima jugada</p>
          <h2 class="mt-1 font-display text-xl font-bold text-text">Únete a una quiniela</h2>
          <p class="mt-2 text-sm leading-5 text-text-muted">Ingresa el código que te compartió tu organizador y compite con tu comunidad.</p>
          <PrimaryButton class="mt-5" @click="joinOpen = true"><KeyRound class="h-4 w-4" />Unirme con código</PrimaryButton>
        </div>

        <EmptyState :icon="Trophy" title="Aún no perteneces a ninguna quiniela" description="Cuando te unas, aquí verás tus próximos partidos y tu posición.">
          <template #action>
            <SecondaryButton @click="joinOpen = true">Ingresar código</SecondaryButton>
          </template>
        </EmptyState>

        <div>
          <div class="mb-3 flex items-center justify-between"><h2 class="font-display text-base font-bold text-text">Cómo funciona</h2><span class="text-xs font-semibold text-primary">Empieza hoy</span></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="app-surface p-3 text-center">
              <KeyRound class="mx-auto h-5 w-5 text-primary" />
              <p class="mt-2 text-xs font-semibold text-text">1. Únete</p>
            </div>
            <div class="app-surface p-3 text-center">
              <Target class="mx-auto h-5 w-5 text-primary" />
              <p class="mt-2 text-xs font-semibold text-text">2. Predice</p>
            </div>
            <div class="app-surface p-3 text-center">
              <ListChecks class="mx-auto h-5 w-5 text-primary" />
              <p class="mt-2 text-xs font-semibold text-text">3. Compite</p>
            </div>
          </div>
        </div>
      </template>
    </section>
  </AppShell>
</template>
