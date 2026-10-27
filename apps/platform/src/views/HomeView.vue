<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck, Trophy, UsersRound, Zap } from 'lucide-vue-next'
import coverBackground from '../assets/backgrounds/fondo_app_tablo.jpg'
import coverLogo from '../assets/branding/logo_app_tablo.png'
import AppShell from '../components/AppShell.vue'
import HomeDashboard from '../components/HomeDashboard.vue'
import AuthForm, { type AuthMode } from '../components/AuthForm.vue'
import BottomSheet from '../components/BottomSheet.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SportIcon from '../components/SportIcon.vue'
import { useAuth } from '../composables/useAuth'
import { normalizeJoinCode } from '../lib/join-intent'
import type { SportFilter } from '../lib/sports-catalog'

const router = useRouter()
const auth = useAuth()

const code = ref('')
const codeError = ref('')
const authPanel = ref(false)
const joinOpen = ref(false)
const authMode = ref<AuthMode>('sign-in')
const coverSports: SportFilter[] = ['all', 'football', 'basketball', 'tennis', 'volleyball']

function goToJoin(): void {
  const normalized = normalizeJoinCode(code.value)
  if (!normalized) { codeError.value = 'Ingresa un código válido de seis caracteres.'; return }
  codeError.value = ''
  void router.push({ name: 'join', params: { code: normalized } })
}

function openAuth(mode: AuthMode): void {
  authMode.value = mode
  authPanel.value = true
}
</script>

<template>
  <AppShell
    :variant="auth.isAuthenticated.value ? 'app' : 'screen'"
    active="home"
    title="Inicio"
    :user-name="auth.state.profile?.display_name"
  >
    <section v-if="!auth.isAuthenticated.value && !authPanel" class="relative -mx-5 flex w-[calc(100%+2.5rem)] flex-1 flex-col overflow-hidden bg-canvas px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-center">
      <img :src="coverBackground" alt="" fetchpriority="high" decoding="async" class="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <div class="pointer-events-none absolute inset-0 bg-linear-to-b from-canvas/30 via-canvas/10 to-canvas/85" />
      <div class="relative flex flex-1 flex-col">
        <div class="mx-auto mt-[4dvh] flex flex-col items-center">
          <div class="relative flex items-center justify-center">
            <div class="absolute -inset-2 rounded-full bg-primary/25 blur-xl"></div>
            <svg viewBox="0 0 48 48" class="relative h-14 w-14 text-primary drop-shadow-[0_0_16px_rgba(33,245,154,0.7)]" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 8h24v14c0 6.627-5.373 12-12 12s-12-5.373-12-12V8z" />
              <path d="M12 14H6a4 4 0 0 0-4 4v2a6 6 0 0 0 6 6h4" />
              <path d="M36 14h6a4 4 0 0 1 4 4v2a6 6 0 0 1-6 6h-4" />
              <path d="M24 34v6" />
              <path d="M16 40h16" />
            </svg>
          </div>
          <h1 class="mt-3 font-display text-4xl font-extrabold tracking-tight text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]">
            Sport<span class="text-primary">Leagues</span>
          </h1>
        </div>
        <p class="mx-auto mt-2 max-w-48 font-display text-[16px] font-bold leading-tight text-text drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">Tu pasión,<br />en cada partido</p>
        <div class="mt-5 flex items-center justify-center gap-2" aria-label="Deportes disponibles">
          <span v-for="sport in coverSports" :key="sport" class="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-canvas/60 text-text backdrop-blur-md shadow-sm">
            <SportIcon :sport="sport" class="h-4.5 w-4.5" />
          </span>
        </div>
        <div class="flex-1" />
        <div class="space-y-3">
          <button type="button" class="press-scale flex w-full items-center justify-center gap-3 rounded-full bg-primary px-5 py-4 text-[16px] font-extrabold text-canvas shadow-[0_0_24px_rgba(33,245,154,0.35)] hover:bg-[#34f7a5]" @click="openAuth('sign-in')">
            <span>Iniciar sesión</span><ArrowRight class="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" class="press-scale w-full rounded-full border border-white/20 bg-black/40 px-5 py-4 text-[16px] font-bold text-text backdrop-blur-md hover:border-white/40" @click="openAuth('sign-up')">Crear cuenta</button>
        </div>
        <p class="mt-7 text-xs font-semibold text-text/90">Juega <span class="mx-2 text-primary font-bold">•</span> Compite <span class="mx-2 text-primary font-bold">•</span> Conecta</p>
      </div>
    </section>

    <section v-else-if="!auth.isAuthenticated.value" class="relative -mx-5 flex w-[calc(100%+2.5rem)] flex-1 flex-col overflow-hidden px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-[url('/images/stadium-night-alex-simpson.jpg')] bg-cover bg-top" aria-hidden="true" />
      <div class="pointer-events-none absolute inset-x-0 top-0 h-[26rem] bg-linear-to-b from-canvas/55 via-canvas/65 to-canvas" aria-hidden="true" />
      <div class="relative flex flex-1 flex-col justify-between gap-3">
        <div class="relative space-y-3">
          <button type="button" class="icon-button press-scale absolute left-0 top-0 z-10 text-text-muted" aria-label="Volver" @click="authPanel = false"><ArrowLeft class="h-5 w-5" /></button>
          <div v-if="authMode === 'sign-in'" class="pt-2 text-center [@media(max-height:700px)]:hidden">
            <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-primary to-primary-600 text-canvas shadow-glow-primary">
              <Trophy class="h-8 w-8" aria-hidden="true" />
            </span>
            <h1 class="mt-3 font-display text-4xl font-extrabold leading-none tracking-tight text-text">Sport<span class="text-primary">Leagues</span></h1>
            <p class="mt-2 text-sm text-text-muted">Tu pasión, en cada partido.</p>
            <ul class="mt-3 flex items-center justify-center divide-x divide-border-strong rounded-pill border border-secondary/15 bg-canvas/40 py-1.5 text-[11px] font-medium text-text backdrop-blur-sm" aria-label="Ventajas">
              <li class="flex flex-1 items-center justify-center gap-1 px-1"><ShieldCheck class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />100% Seguro</li>
              <li class="flex flex-1 items-center justify-center gap-1 px-1"><Zap class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Rápido y fácil</li>
              <li class="flex flex-1 items-center justify-center gap-1 px-1"><UsersRound class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Multideporte</li>
            </ul>
          </div>
          <div class="min-h-11 items-center justify-center gap-3" :class="authMode === 'sign-in' ? 'hidden [@media(max-height:700px)]:flex' : 'flex'">
            <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-primary to-primary-600 text-canvas shadow-glow-primary"><Trophy class="h-5 w-5" aria-hidden="true" /></span>
            <h1 class="font-display text-3xl font-extrabold leading-none tracking-tight text-text">Sport<span class="text-primary">Leagues</span></h1>
          </div>
        </div>

        <div class="space-y-2">
          <AuthForm v-model:mode="authMode" />
          <button type="button" class="press-scale mx-auto flex min-h-11 items-center gap-2 text-sm font-semibold text-text-muted hover:text-text" @click="joinOpen = true">
            <KeyRound class="h-4 w-4 text-primary" aria-hidden="true" />¿Tienes un código de invitación?
          </button>
        </div>
      </div>

      <BottomSheet v-model:open="joinOpen" title="Unirme con un código">
        <form class="flex items-start gap-2" @submit.prevent="goToJoin">
          <div class="flex-1">
            <FormField id="join-code" v-model="code" label="Código de unión" placeholder="AB12CD" :maxlength="6" autocomplete="off" input-class="text-center font-display tracking-[0.3em] uppercase" :error="codeError" />
          </div>
          <PrimaryButton type="submit" :full-width="false" class="mt-6">Unirme</PrimaryButton>
        </form>
      </BottomSheet>
    </section>

    <HomeDashboard v-else />
  </AppShell>
</template>
