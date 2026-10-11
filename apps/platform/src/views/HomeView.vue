<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, KeyRound, ShieldCheck, Trophy, UsersRound, Zap } from 'lucide-vue-next'
import coverBackground from '../assets/backgrounds/fondo_app_tablo.png'
import coverLogo from '../assets/branding/logo_app_tablo.png'
import AppShell from '../components/AppShell.vue'
import HomeDashboard from '../components/HomeDashboard.vue'
import AuthForm, { type AuthMode } from '../components/AuthForm.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SportIcon from '../components/SportIcon.vue'
import { useAuth } from '../composables/useAuth'
import { normalizeJoinCode } from '../lib/join-intent'
import type { SportKey } from '../lib/sports-catalog'

const router = useRouter()
const auth = useAuth()

const code = ref('')
const codeError = ref('')
const authPanel = ref(false)
const authMode = ref<AuthMode>('sign-in')
const coverSports: SportKey[] = ['football', 'volleyball', 'basketball', 'tennis']

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
    :variant="auth.isAuthenticated.value ? 'app' : 'focus'"
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
          <span v-for="sport in coverSports" :key="sport" class="flex h-8 w-8 items-center justify-center rounded-full border border-text/20 bg-canvas/45 text-text backdrop-blur-sm">
            <SportIcon :sport="sport" class="h-4 w-4" />
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

    <section v-else-if="!auth.isAuthenticated.value" class="relative -mx-5 w-[calc(100%+2.5rem)] self-start overflow-hidden px-5 pb-8 pt-2">
      <div class="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[url('/images/stadium-night-alex-simpson.jpg')] bg-cover bg-top" aria-hidden="true" />
      <div class="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-linear-to-b from-canvas/55 via-canvas/65 to-canvas" aria-hidden="true" />
      <div class="relative space-y-5">
        <button type="button" class="press-scale inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-text-muted hover:text-text" @click="authPanel = false"><ArrowLeft class="h-4 w-4" />Volver</button>
        <div class="text-center">
          <span class="mx-auto flex h-24 w-24 items-center justify-center rounded-[1.75rem] bg-linear-to-br from-primary to-primary-600 text-canvas shadow-glow-primary">
            <Trophy class="h-12 w-12" aria-hidden="true" />
          </span>
          <h1 class="mt-5 font-display text-5xl font-extrabold leading-none tracking-tight text-text">Sport<span class="text-primary">Leagues</span></h1>
          <p class="mt-3 text-base text-text-muted">Tu pasión, en cada partido.</p>
          <ul class="mt-5 flex items-center justify-center divide-x divide-border-strong rounded-pill border border-secondary/15 bg-canvas/40 py-2 text-[11px] font-medium text-text backdrop-blur-sm" aria-label="Ventajas">
            <li class="flex flex-1 items-center justify-center gap-1 px-1"><ShieldCheck class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />100% Seguro</li>
            <li class="flex flex-1 items-center justify-center gap-1 px-1"><Zap class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Rápido y fácil</li>
            <li class="flex flex-1 items-center justify-center gap-1 px-1"><UsersRound class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Multideporte</li>
          </ul>
        </div>

        <AuthForm v-model:mode="authMode" />

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
      </div>
    </section>

    <HomeDashboard v-else />
  </AppShell>
</template>
