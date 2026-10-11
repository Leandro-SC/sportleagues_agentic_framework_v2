<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChartNoAxesCombined, Settings2, Ticket, Trophy, UsersRound, ShieldCheck } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { useAuth } from '../composables/useAuth'
import { useAdmin } from '../composables/useAdmin'

const router = useRouter()
const auth = useAuth()
const admin = useAdmin()
onMounted(() => { if (auth.state.user) void admin.load(auth.state.user.id) })
watch(admin.selectedTenantId, (tenantId, previousId) => { if (previousId && tenantId !== previousId) void admin.loadPools() })
</script>

<template>
  <AppShell variant="app" active="profile" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Panel del organizador" :back="{ name: 'home' }" />
    <div class="space-y-4 pb-4">
      <p class="text-sm text-text-muted">Gestiona únicamente las organizaciones y quinielas en las que tienes permisos de administración.</p>
      <p v-if="admin.loading.value" role="status" class="text-sm text-text-muted">Verificando tus permisos…</p>
      <p v-else-if="admin.error.value" role="alert" class="text-sm text-danger">{{ admin.error.value }}</p>
      <template v-else-if="admin.tenants.value.length">
        <label class="block text-sm font-semibold text-text">Organización autorizada
          <select v-model="admin.selectedTenantId.value" class="field-surface mt-2 w-full px-3 py-3 text-sm" aria-label="Cambiar organización administrada">
            <option v-for="tenant in admin.tenants.value" :key="tenant.tenant_id" :value="tenant.tenant_id">Organización {{ tenant.tenant_id.slice(0, 8) }} · {{ tenant.role }}</option>
          </select>
        </label>
        <section class="app-surface space-y-2 p-4" aria-label="Resumen administrativo">
          <h2 class="font-display text-lg font-bold text-text">Tus quinielas</h2>
          <p class="text-3xl font-bold text-primary">{{ admin.pools.value.length }}</p>
          <p class="text-xs text-text-muted">Quinielas del contexto seleccionado; no incluye otras organizaciones.</p>
        </section>
        <div class="grid grid-cols-2 gap-3" aria-label="Herramientas del organizador">
          <button class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({name:'admin'})"><Settings2 class="h-6 w-6 text-primary"/><span class="text-sm font-bold text-text">Administrar ligas</span><span class="text-xs text-text-muted">Reglas y configuración</span></button>
          <button class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({name:'admin'})"><UsersRound class="h-6 w-6 text-primary"/><span class="text-sm font-bold text-text">Participantes</span><span class="text-xs text-text-muted">Aprobaciones y pagos manuales</span></button>
          <button class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({name:'admin-income'})"><Ticket class="h-6 w-6 text-primary"/><span class="text-sm font-bold text-text">Tickets e ingresos</span><span class="text-xs text-text-muted">Panel financiero en preparación</span></button>
          <button class="app-surface flex min-h-28 flex-col items-start justify-center gap-2 p-4 text-left" @click="router.push({name:'admin'})"><Trophy class="h-6 w-6 text-primary"/><span class="text-sm font-bold text-text">Competiciones</span><span class="text-xs text-text-muted">Gestión según fase habilitada</span></button>
        </div>
        <section class="app-surface space-y-2 p-4"><h2 class="flex items-center gap-2 font-bold text-text"><ChartNoAxesCombined class="h-5 w-5 text-primary"/>Reportes</h2><p class="text-sm text-text-muted">Las métricas de ventas y pronósticos se activarán cuando existan tickets, pagos confirmados y scoring persistidos en el servidor. No se generan ingresos simulados.</p></section>
        <p class="flex items-start gap-2 text-xs text-text-muted"><ShieldCheck class="h-4 w-4 shrink-0 text-primary"/>Cambiar la organización no concede permisos. Todas las operaciones deben comprobar la membresía y RLS en servidor.</p>
      </template>
      <EmptyState v-else :icon="ShieldCheck" title="Sin organizaciones administrables" description="Si quieres organizar una quiniela, solicita o completa el proceso autorizado de creación. Elegir el modo organizador no concede permisos."/>
    </div>
  </AppShell>
</template>
