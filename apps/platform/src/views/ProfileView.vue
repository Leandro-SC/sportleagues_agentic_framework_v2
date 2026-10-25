<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Award, BadgeCheck, ChevronLeft, FileText, History, LayoutDashboard, ChartNoAxesColumnIncreasing, LoaderCircle, LogOut, Settings, ShieldCheck, Star, Ticket, UserX, UsersRound } from 'lucide-vue-next'
import ActivityRow from '../components/ActivityRow.vue'
import AppShell from '../components/AppShell.vue'
import CatalogBoundary from '../components/CatalogBoundary.vue'
import BottomSheet from '../components/BottomSheet.vue'
import EmptyState from '../components/EmptyState.vue'
import FollowedTeamCard from '../components/FollowedTeamCard.vue'
import PoolCreationRequestCard from '../components/PoolCreationRequestCard.vue'
import PreviewBadge from '../components/PreviewBadge.vue'
import SegmentedTabs from '../components/SegmentedTabs.vue'
import { DELETE_CONFIRMATION, blockerMessages, useAccountDeletion } from '../composables/useAccountDeletion'
import { useAuth } from '../composables/useAuth'
import { useFollowedTeams } from '../composables/useFollowedTeams'
import { useMyPools } from '../composables/useMyPools'
import { useRouteTab } from '../composables/useRouteTab'
import { useSportsCatalog } from '../composables/useSportsCatalog'
import { useTenantAdminAccess } from '../composables/useTenantAdminAccess'
import { initialsOf } from '../lib/sports-catalog'

const TABS = ['actividad', 'equipos', 'logros'] as const
type Tab = (typeof TABS)[number]

const router = useRouter()
const auth = useAuth()
const sports = useSportsCatalog()
const myPools = useMyPools()
const adminAccess = useTenantAdminAccess()
const followed = useFollowedTeams(() => sports.catalog.value.followedTeamIds)
const tab = useRouteTab<Tab>(TABS, 'actividad')

const settingsOpen = ref(false)
const loggingOut = ref(false)
const error = ref('')

const tabOptions: Array<{ value: Tab; label: string }> = [
  { value: 'actividad', label: 'Mi actividad' },
  { value: 'equipos', label: 'Equipos' },
  { value: 'logros', label: 'Logros' },
]

// La solicitud solo se ofrece cuando se pudo comprobar que la cuenta NO administra ninguna organización.
const canRequestPool = computed(() => Boolean(auth.state.user) && !adminAccess.loading.value && !adminAccess.error.value && !adminAccess.hasTenantAdminAccess.value)
const initials = computed(() => initialsOf(auth.state.profile?.display_name))
const previewStats = computed(() => sports.catalog.value.profileStats)
const followedTeams = computed(() => followed.ids.value.map((id) => sports.team(id)).filter((team) => team !== undefined))
const stats = computed(() => [
  { label: 'Ligas', value: myPools.loading.value ? '…' : String(myPools.pools.value.length) },
  { label: 'Torneos', value: previewStats.value ? String(previewStats.value.tournaments) : '–' },
  { label: 'Puntos', value: previewStats.value ? String(previewStats.value.points) : '–' },
])

onMounted(() => {
  const profileId = auth.state.user?.id
  void myPools.load(profileId)
  if (profileId) void adminAccess.checkAccess(profileId)
})

const deletion = useAccountDeletion()
const deletionOpen = ref(false)
const deleteConfirmation = ref('')

function openDeletion(): void {
  settingsOpen.value = false
  deleteConfirmation.value = ''
  deletion.blockers.value = null
  deletionOpen.value = true
  void deletion.loadBlockers()
}

async function confirmDeletion(): Promise<void> {
  if (!(await deletion.deleteAccount(deleteConfirmation.value.toUpperCase()))) return
  deletionOpen.value = false
  // La sesión del servidor ya fue revocada; se limpia la local y se vuelve a Inicio.
  await auth.signOut()
  await router.replace({ name: 'home' })
}

async function logout(): Promise<void> {
  loggingOut.value = true
  error.value = ''
  // `signOut` limpia siempre el estado local (aunque el servidor falle): se sale a Inicio en cualquier caso (FE-06).
  await auth.signOut()
  loggingOut.value = false
  settingsOpen.value = false
  await router.replace({ name: 'home' })
}
</script>

<template>
  <AppShell variant="app" active="profile" :user-name="auth.state.profile?.display_name">
    <header class="safe-top flex items-center justify-between pb-1 pt-2">
      <button type="button" class="press-scale icon-button -ml-2.5" aria-label="Volver al inicio" @click="router.push({ name: 'home' })">
        <ChevronLeft class="h-6 w-6" />
      </button>
      <h1 class="sr-only">Perfil</h1>
      <button type="button" class="press-scale icon-button -mr-2.5" aria-label="Ajustes de la cuenta" @click="settingsOpen = true">
        <Settings class="h-6 w-6" />
      </button>
    </header>

    <section class="space-y-3.5 pb-2">
      <div class="flex flex-col items-center text-center">
        <span class="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-text/80 bg-canvas font-display text-xl font-bold text-text">
          {{ initials }}
          <BadgeCheck class="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-canvas text-primary" aria-label="Cuenta verificada" />
        </span>
        <p class="mt-2 font-display text-lg font-bold text-text">{{ auth.state.profile?.display_name ?? 'Sin nombre' }}</p>
        <p class="text-sm text-text-muted">{{ auth.state.user?.email }}</p>
        <div v-if="previewStats" class="mt-2 flex items-center gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-primary/60 bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary">
            <Star class="h-3.5 w-3.5" aria-hidden="true" />{{ previewStats.level }}
          </span>
          <span class="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">+{{ previewStats.weeklyPoints }} pts</span>
          <PreviewBadge />
        </div>
      </div>

      <dl class="grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-linear-to-b from-surface-2/70 to-surface py-2.5">
        <div v-for="item in stats" :key="item.label" class="flex flex-col-reverse items-center gap-0.5">
          <dt class="text-xs text-text-muted">{{ item.label }}</dt>
          <dd class="font-display text-xl font-bold text-text">{{ item.value }}</dd>
        </div>
      </dl>
      <p v-if="myPools.error.value" class="text-center text-xs text-danger" role="alert">{{ myPools.error.value }}</p>

      <PoolCreationRequestCard v-if="canRequestPool" />

      <SegmentedTabs v-model="tab" :options="tabOptions" label="Secciones del perfil" variant="underline" />

      <CatalogBoundary v-if="sports.loading.value || sports.failed.value" :loading="sports.loading.value" :failed="sports.failed.value" :rows="3" row-height="5rem" @retry="sports.retry" />

      <template v-else-if="tab === 'actividad'">
        <ul v-if="sports.catalog.value.activity.length" class="space-y-2.5">
          <ActivityRow v-for="item in sports.catalog.value.activity" :key="item.id" :item="item" :now="sports.now.value" />
        </ul>
        <EmptyState v-else :icon="History" title="Sin actividad todavía" description="Aquí verás tus uniones a ligas, pronósticos y resultados." />
      </template>

      <template v-else-if="tab === 'equipos'">
        <div v-if="followedTeams.length" class="grid grid-cols-2 gap-3">
          <FollowedTeamCard
            v-for="team in followedTeams"
            :key="team.id"
            :team="team"
            :subtitle="sports.competition(team.competition_id)?.name ?? team.country_name"
          />
        </div>
        <EmptyState v-else :icon="UsersRound" title="No sigues equipos" description="Abre la ficha de un equipo y pulsa “Seguir equipo”." />
      </template>

      <EmptyState v-else :icon="Award" title="Logros próximamente" description="Los logros no forman parte del MVP; tus puntos y posiciones llegarán con la tabla de la liga." />
    </section>

    <BottomSheet v-model:open="settingsOpen" title="Ajustes">
      <div class="space-y-2">
        <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-text hover:bg-surface-2" @click="settingsOpen = false; router.push({ name: 'points' })">
          <ChartNoAxesColumnIncreasing class="h-5 w-5 text-primary" aria-hidden="true" />Mis puntos por quiniela
        </button>
        <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-text hover:bg-surface-2" @click="settingsOpen = false; router.push({ name: 'my-tickets' })">
          <Ticket class="h-5 w-5 text-primary" aria-hidden="true" />Mis tickets
        </button>
        <button
          v-if="adminAccess.hasTenantAdminAccess.value"
          type="button"
          class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-text hover:bg-surface-2"
          @click="settingsOpen = false; router.push({ name: 'organizer-dashboard' })"
        >
          <LayoutDashboard class="h-5 w-5 text-secondary" aria-hidden="true" />Modo organizador
        </button>
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-danger hover:bg-danger-100 disabled:opacity-60"
          :disabled="loggingOut"
          @click="logout"
        >
          <LogOut class="h-5 w-5" aria-hidden="true" />{{ loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión' }}
        </button>
        <p v-if="error" class="px-3 text-sm font-medium text-danger" role="alert">{{ error }}</p>
        <div class="mt-2 border-t border-border pt-2">
          <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-text hover:bg-surface-2" @click="settingsOpen = false; router.push({ name: 'privacy' })">
            <ShieldCheck class="h-5 w-5 text-text-muted" aria-hidden="true" />Política de privacidad
          </button>
          <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-text hover:bg-surface-2" @click="settingsOpen = false; router.push({ name: 'terms' })">
            <FileText class="h-5 w-5 text-text-muted" aria-hidden="true" />Términos de uso
          </button>
          <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-danger hover:bg-danger-100" data-testid="open-delete-account" @click="openDeletion">
            <UserX class="h-5 w-5" aria-hidden="true" />Eliminar mi cuenta
          </button>
        </div>
      </div>
    </BottomSheet>

    <BottomSheet v-model:open="deletionOpen" title="Eliminar mi cuenta">
      <div class="space-y-3 text-sm text-text-muted" data-testid="delete-account-sheet">
        <p>Se borrarán tu correo y tus datos de acceso, y no podrás volver a entrar con esta cuenta. En las quinielas donde participaste tu nombre aparecerá como «Usuario eliminado» para no alterar resultados ya jugados.</p>
        <p v-if="deletion.blockers.value === null && !deletion.error.value" class="flex items-center gap-2"><LoaderCircle class="h-4 w-4 animate-spin" />Comprobando tu cuenta…</p>
        <ul v-if="deletion.blockers.value?.length" class="space-y-1 rounded-xl bg-warn-100 p-3 font-medium text-warn" role="status" data-testid="delete-account-blockers">
          <li v-for="message in blockerMessages(deletion.blockers.value)" :key="message">{{ message }}</li>
        </ul>
        <template v-if="deletion.blockers.value && !deletion.blockers.value.length">
          <label class="block font-medium text-text">Escribe {{ DELETE_CONFIRMATION }} para confirmar
            <input v-model="deleteConfirmation" class="field-surface mt-1.5 w-full px-4 py-3 text-[15px] uppercase" autocomplete="off" autocapitalize="characters" data-testid="delete-account-confirmation" />
          </label>
          <button type="button" class="press-scale flex min-h-12 w-full items-center justify-center gap-2 rounded-pill bg-danger px-5 font-bold text-white disabled:opacity-50"
            :disabled="deletion.deleting.value || deleteConfirmation.trim().toUpperCase() !== DELETE_CONFIRMATION" data-testid="confirm-delete-account" @click="confirmDeletion">
            <LoaderCircle v-if="deletion.deleting.value" class="h-4 w-4 animate-spin" />Eliminar mi cuenta definitivamente
          </button>
        </template>
        <p v-if="deletion.error.value" class="font-medium text-danger" role="alert">{{ deletion.error.value }}</p>
      </div>
    </BottomSheet>
  </AppShell>
</template>
