<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Wallet } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { useAuth } from '../composables/useAuth'
import { useAdmin } from '../composables/useAdmin'

const auth = useAuth()
const admin = useAdmin()
const router = useRouter()
onMounted(() => { if (auth.state.user) void admin.load(auth.state.user.id) })
</script>

<template>
  <AppShell variant="app" active="home" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Ingresos y tickets" :back="{ name: 'admin' }" />
    <section class="space-y-4">
      <p class="text-sm text-text-muted">Espacio exclusivo para organizadores autorizados. Los puntos de pronósticos no son ingresos económicos.</p>
      <p v-if="admin.loading.value" role="status" class="text-sm text-text-muted">Comprobando ligas administradas…</p>
      <p v-else-if="admin.error.value" role="alert" class="text-sm text-danger">{{ admin.error.value }}</p>
      <template v-else>
        <label v-if="admin.tenants.value.length" class="block text-sm font-medium text-text-muted">Organización
          <select v-model="admin.selectedTenantId.value" class="field-surface mt-1.5 w-full px-3 py-3 text-sm">
            <option v-for="tenant in admin.tenants.value" :key="tenant.tenant_id" :value="tenant.tenant_id">Tenant {{ tenant.tenant_id.slice(0, 8) }}</option>
          </select>
        </label>
        <EmptyState :icon="Wallet" title="Ingresos aún no disponibles" description="El estado manual de pago de participantes no permite calcular ingresos reales: faltan importes, tickets y transacciones confirmadas. No mostramos cifras ficticias." />
        <div class="app-surface space-y-2 p-4 text-sm text-text-muted">
          <h2 class="font-display font-bold text-text">Próximamente: resumen de ventas</h2>
          <p>Tickets emitidos, pagos confirmados, pendientes, reembolsos y desglose de ingresos por quiniela y jornada, sujetos a la implementación segura del libro de operaciones.</p>
          <button type="button" class="font-semibold text-primary underline underline-offset-4" @click="router.push({ name: 'admin' })">Administrar participantes y pagos manuales</button>
        </div>
      </template>
    </section>
  </AppShell>
</template>
