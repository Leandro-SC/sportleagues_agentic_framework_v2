<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChartNoAxesCombined, ShieldCheck, Trophy, UsersRound, Wallet, CalendarClock, Crown } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { useAdmin } from '../composables/useAdmin'
import { useIdentityWatch } from '../composables/useIdentityWatch'

const router = useRouter()
const auth = useAuth()
// Solo organizaciones y quinielas: sin lectura de branding ni polling (FE-03).
const admin = useAdmin({ branding: false })
const roleLabel = (role: string): string => (role === 'owner' ? 'Propietario' : 'Administrador')

function reload(): void { if (auth.state.user) void admin.load(auth.state.user.id) }
onMounted(reload)
watch(admin.selectedTenantId, (tenantId, previousId) => { if (previousId && tenantId !== previousId) void admin.loadPools() })
// Otra identidad en la misma pestaña (FE-05): descarta lo cargado y recarga, o sale si ya no hay sesión.
useIdentityWatch(auth, {
  onChange: (userId) => { admin.reset(); void admin.load(userId) },
  onSignedOut: () => { admin.reset(); void router.replace({ name: 'home' }) },
})
onBeforeUnmount(admin.dispose)
</script>

<template>
  <AppShell variant="app" active="panel" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Panel del organizador" :back="{ name: 'home' }" />
    <div class="space-y-4 pb-4">
      <p class="text-sm text-text-muted">Gestiona únicamente las organizaciones y quinielas en las que tienes permisos de administración.</p>
      <p v-if="admin.loading.value" role="status" class="text-sm text-text-muted">Verificando tus permisos…</p>
      <div v-else-if="admin.error.value" class="space-y-3">
        <p role="alert" class="text-sm text-danger">{{ admin.error.value }}</p>
        <SecondaryButton @click="reload">Reintentar</SecondaryButton>
      </div>
      <template v-else-if="admin.tenants.value.length">
        <label class="block text-sm font-semibold text-text">Organización autorizada
          <select v-model="admin.selectedTenantId.value" class="field-surface mt-2 min-h-11 w-full px-3 py-3 text-sm" aria-label="Cambiar organización administrada">
            <option v-for="tenant in admin.tenants.value" :key="tenant.tenant_id" :value="tenant.tenant_id">Organización {{ tenant.tenant_id.slice(0, 8) }} · {{ roleLabel(tenant.role) }}</option>
          </select>
        </label>
        <section class="app-surface space-y-2 p-4" aria-label="Resumen administrativo">
          <h2 class="font-display text-lg font-bold text-text">Tus quinielas</h2>
          <p class="text-3xl font-bold text-primary">{{ admin.pools.value.length }}</p>
          <p class="text-xs text-text-muted">Quinielas del contexto seleccionado; no incluye otras organizaciones.</p>
        </section>
        <div class="grid grid-cols-2 gap-3" aria-label="Herramientas del organizador">
          <button type="button" data-test="tile-pools" class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({ name: 'admin' })"><Trophy class="h-6 w-6 text-primary" aria-hidden="true" /><span class="text-sm font-bold text-text">Mis quinielas</span><span class="text-xs text-text-muted">Estado, reglas y código de unión</span></button>
          <button type="button" data-test="tile-participants" class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({ name: 'admin' })"><UsersRound class="h-6 w-6 text-primary" aria-hidden="true" /><span class="text-sm font-bold text-text">Participantes</span><span class="text-xs text-text-muted">Aprobaciones y pagos manuales</span></button>
          <button type="button" data-test="tile-fixture" class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({ name: 'admin-fixture' })"><CalendarClock class="h-6 w-6 text-primary" aria-hidden="true" /><span class="text-sm font-bold text-text">Parrilla deportiva</span><span class="text-xs text-text-muted">Equipos, torneos, partidos y resultados</span></button>
          <button type="button" data-test="tile-finance" class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({ name: 'admin-income' })"><Wallet class="h-6 w-6 text-primary" aria-hidden="true" /><span class="text-sm font-bold text-text">Mis finanzas</span><span class="text-xs text-text-muted">Estado de pago manual (solo lectura)</span></button>
          <button type="button" data-test="tile-plans" class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({ name: 'plans' })"><Crown class="h-6 w-6 text-primary" aria-hidden="true" /><span class="text-sm font-bold text-text">Planes</span><span class="text-xs text-text-muted">Beneficios y solicitud PRO</span></button>
        </div>
        <button type="button" disabled data-test="tile-reports" class="app-surface flex min-h-14 w-full items-center gap-3 p-4 text-left opacity-60">
          <ChartNoAxesCombined class="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
          <span class="flex-1"><span class="block text-sm font-bold text-text">Reportes</span><span class="block text-xs text-text-muted">No disponible en esta versión.</span></span>
          <span class="rounded-pill bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted">No disponible</span>
        </button>
        <p class="flex items-start gap-2 text-xs text-text-muted"><ShieldCheck class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />Cambiar la organización no concede permisos. Todas las operaciones se comprueban en el servidor con tu membresía.</p>
      </template>
      <EmptyState v-else :icon="ShieldCheck" title="Sin organizaciones administrables" description="No administras ninguna organización con esta cuenta. Puedes pedir organizar tu propia quiniela desde Mi perfil; un operador autorizado revisa cada solicitud." />
    </div>
  </AppShell>
</template>
