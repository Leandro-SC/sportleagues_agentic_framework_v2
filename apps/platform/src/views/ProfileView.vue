<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Award, BadgeCheck, ChevronLeft, History, LayoutDashboard, LogOut, Settings, Star, UsersRound } from 'lucide-vue-next'
import ActivityRow from '../components/ActivityRow.vue'
import AppShell from '../components/AppShell.vue'
import CatalogBoundary from '../components/CatalogBoundary.vue'
import BottomSheet from '../components/BottomSheet.vue'
import EmptyState from '../components/EmptyState.vue'
import FollowedTeamCard from '../components/FollowedTeamCard.vue'
import PreviewBadge from '../components/PreviewBadge.vue'
import SegmentedTabs from '../components/SegmentedTabs.vue'
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

async function logout(): Promise<void> {
  loggingOut.value = true
  error.value = ''
  const result = await auth.signOut()
  loggingOut.value = false
  if (result) { error.value = result; return }
  settingsOpen.value = false
  await router.replace({ name: 'home' })
}
</script>

<template>
  <AppShell variant="app" active="profile" :user-name="auth.state.profile?.display_name">
    <header class="safe-top flex items-center justify-between pb-2 pt-4">
      <button type="button" class="press-scale icon-button -ml-2.5" aria-label="Volver al inicio" @click="router.push({ name: 'home' })">
        <ChevronLeft class="h-6 w-6" />
      </button>
      <h1 class="sr-only">Perfil</h1>
      <button type="button" class="press-scale icon-button -mr-2.5" aria-label="Ajustes de la cuenta" @click="settingsOpen = true">
        <Settings class="h-6 w-6" />
      </button>
    </header>

    <section class="space-y-5 pb-4">
      <div class="flex flex-col items-center text-center">
        <span class="relative flex h-24 w-24 items-center justify-center rounded-full border-2 border-text/80 bg-canvas font-display text-3xl font-bold text-text">
          {{ initials }}
          <BadgeCheck class="absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-full bg-canvas text-primary" aria-label="Cuenta verificada" />
        </span>
        <p class="mt-3 font-display text-xl font-bold text-text">{{ auth.state.profile?.display_name ?? 'Sin nombre' }}</p>
        <p class="text-sm text-text-muted">{{ auth.state.user?.email }}</p>
        <div v-if="previewStats" class="mt-3 flex items-center gap-2">
          <span class="inline-flex items-center gap-1.5 rounded-lg border border-primary/60 bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary">
            <Star class="h-3.5 w-3.5" aria-hidden="true" />{{ previewStats.level }}
          </span>
          <span class="rounded-lg bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">+{{ previewStats.weeklyPoints }} pts</span>
          <PreviewBadge />
        </div>
      </div>

      <dl class="grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-linear-to-b from-surface-2/70 to-surface py-4">
        <div v-for="item in stats" :key="item.label" class="flex flex-col-reverse items-center gap-0.5">
          <dt class="text-sm text-text-muted">{{ item.label }}</dt>
          <dd class="font-display text-2xl font-bold text-text">{{ item.value }}</dd>
        </div>
      </dl>
      <p v-if="myPools.error.value" class="text-center text-xs text-danger" role="alert">{{ myPools.error.value }}</p>

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
        <button
          v-if="adminAccess.hasTenantAdminAccess.value"
          type="button"
          class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-text hover:bg-surface-2"
          @click="settingsOpen = false; router.push({ name: 'admin' })"
        >
          <LayoutDashboard class="h-5 w-5 text-secondary" aria-hidden="true" />Panel de administración
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
      </div>
    </BottomSheet>
  </AppShell>
</template>
