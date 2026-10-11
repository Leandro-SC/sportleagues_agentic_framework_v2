<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { ChartColumn, CirclePlus, ListOrdered, Trophy, UserRoundPlus, UsersRound } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import BottomSheet from '../components/BottomSheet.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import PoolCard from '../components/PoolCard.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import SectionHeader from '../components/SectionHeader.vue'
import { useAuth } from '../composables/useAuth'
import { useMyPools } from '../composables/useMyPools'
import { useTenantAdminAccess } from '../composables/useTenantAdminAccess'

const router = useRouter()
const auth = useAuth()
const myPools = useMyPools()
const adminAccess = useTenantAdminAccess()
const organizerSheet = ref(false)
const checkingAdmin = ref(false)

const features = [
  { icon: ListOrdered, label: 'Tabla de posiciones' },
  { icon: ChartColumn, label: 'Estadísticas en tiempo real' },
  { icon: UsersRound, label: 'Invitaciones y amigos' },
]

onMounted(() => { void myPools.load(auth.state.user?.id) })

// Crear una liga es una operación de organizador: el alta de quinielas vive en /admin y la
// autorización real la deciden el guard de esa ruta y las RPC (owner/admin del tenant).
async function createLeague(): Promise<void> {
  if (!auth.state.user) return
  checkingAdmin.value = true
  const allowed = await adminAccess.checkAccess(auth.state.user.id)
  checkingAdmin.value = false
  if (allowed) void router.push({ name: 'admin' })
  else organizerSheet.value = true
}
</script>

<template>
  <AppShell variant="app" active="leagues" :user-name="auth.state.profile?.display_name">
    <section class="space-y-8 pb-4">
      <div class="stadium-hero relative -mx-5 overflow-hidden px-6 pb-8 pt-14 text-center">
        <div class="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-b from-transparent to-canvas" />
        <div class="relative">
          <Trophy class="mx-auto h-20 w-20 text-primary drop-shadow-[0_0_18px_rgba(33,245,154,0.55)]" :stroke-width="1.5" aria-hidden="true" />
          <h1 class="mx-auto mt-5 max-w-64 font-display text-[26px] font-bold leading-tight text-text">Crea tu propia liga o únete a una</h1>
          <p class="mx-auto mt-3 max-w-72 text-sm leading-relaxed text-text-muted">Compite con tus amigos, arma tu liga y demuestra quién es el mejor.</p>
        </div>
      </div>

      <div class="space-y-3.5">
        <PrimaryButton :loading="checkingAdmin" @click="createLeague">
          <CirclePlus v-if="!checkingAdmin" class="h-5 w-5" />Crear liga
        </PrimaryButton>
        <SecondaryButton @click="router.push({ name: 'league-join' })">
          <UserRoundPlus class="h-5 w-5" />Unirme a una liga
        </SecondaryButton>
      </div>

      <section>
        <h2 class="mb-3 font-display text-base font-bold text-text">Características</h2>
        <ul class="grid grid-cols-3 gap-3">
          <li v-for="feature in features" :key="feature.label" class="flex flex-col items-center gap-2.5 text-center">
            <span class="flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-linear-to-b from-surface-2 to-surface">
              <component :is="feature.icon" class="h-7 w-7 text-primary" aria-hidden="true" />
            </span>
            <span class="text-xs leading-snug text-text-muted">{{ feature.label }}</span>
          </li>
        </ul>
      </section>

      <section>
        <SectionHeader title="Mis ligas" />
        <div v-if="myPools.loading.value" class="space-y-3">
          <LoadingSkeleton height="5.5rem" rounded="rounded-2xl" />
          <LoadingSkeleton height="5.5rem" rounded="rounded-2xl" />
        </div>
        <ErrorState v-else-if="myPools.error.value" :description="myPools.error.value">
          <template #action><SecondaryButton @click="myPools.load(auth.state.user?.id)">Reintentar</SecondaryButton></template>
        </ErrorState>
        <ul v-else-if="myPools.pools.value.length" class="space-y-3">
          <li v-for="pool in myPools.pools.value" :key="pool.id">
            <RouterLink :to="{ name: 'pool', params: { poolId: pool.id } }" class="block">
              <PoolCard :name="pool.name" :status="pool.approval_status === 'pending' ? 'pending' : pool.status === 'archived' ? 'closed' : 'active'" />
            </RouterLink>
          </li>
        </ul>
        <EmptyState v-else :icon="Trophy" title="Todavía no participas en ninguna liga" description="Usa el código de invitación de tu organizador para unirte." />
      </section>
    </section>

    <BottomSheet v-model:open="organizerSheet" title="Crear una liga">
      <div class="space-y-4">
        <p class="text-sm leading-relaxed text-text-muted">
          Las ligas las crean los organizadores desde su panel de administración. Si organizas una liga,
          pide al responsable de tu organización que te asigne como administrador.
        </p>
        <p v-if="adminAccess.error.value" class="rounded-xl bg-danger-100 p-3 text-sm text-danger" role="alert">{{ adminAccess.error.value }}</p>
        <SecondaryButton @click="organizerSheet = false; router.push({ name: 'league-join' })">
          Prefiero unirme a una liga
        </SecondaryButton>
      </div>
    </BottomSheet>
  </AppShell>
</template>
