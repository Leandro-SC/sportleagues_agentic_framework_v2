<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, KeyRound, Sparkles, Trophy } from 'lucide-vue-next'
import coverBackground from '../assets/backgrounds/fondo_app_tablo.png'
import coverLogo from '../assets/branding/logo_app_tablo.png'
import AppShell from '../components/AppShell.vue'
import HomeDashboard from '../components/HomeDashboard.vue'
import AuthForm, { type AuthMode } from '../components/AuthForm.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SportIcon from '../components/SportIcon.vue'
import StatChip from '../components/StatChip.vue'
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
    </section>

    <HomeDashboard v-else />
  </AppShell>
</template>
