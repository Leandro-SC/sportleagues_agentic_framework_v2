<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle, ShieldCheck, Trophy, Wallet } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import StatChip from '../components/StatChip.vue'
import { useAdminFinance } from '../composables/useAdminFinance'
import { useAuth } from '../composables/useAuth'
import { useOnlineStatus } from '../composables/useOnlineStatus'
import { PAYMENT_LABELS, POOL_STATUS_LABELS } from '../lib/admin-finance'

// «Mis finanzas»: resumen de SOLO LECTURA del estado MANUAL de pago/participación de las quinielas
// de la organización seleccionada. Sin importes: en el MVP no existen y no se muestran cifras
// ficticias. El selector se construye solo con las membresías admin activas del usuario autenticado
// (useAdminFinance); nada de la URL (query/params) influye en qué organización se consulta.
const router = useRouter()
const auth = useAuth()
const finance = useAdminFinance()
const { online } = useOnlineStatus()

const tenantLabel = (tenant: { tenant_id: string; name: string | null }): string => tenant.name ?? `Organización ${tenant.tenant_id.slice(0, 8)}`
const hasPools = computed(() => finance.pools.value.length > 0)
const totals = computed(() => finance.summary.value.totals)

onMounted(() => { if (auth.state.user) void finance.load(auth.state.user.id) })
function retry(): void {
  if (finance.tenants.value.length) void finance.reloadSelected()
  else if (auth.state.user) void finance.load(auth.state.user.id)
}
function onTenantChange(event: Event): void { void finance.selectTenant((event.target as HTMLSelectElement).value) }
</script>

<template>
  <AppShell variant="app" active="finance" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Mis finanzas" :back="{ name: 'organizer-dashboard' }" />
    <section class="space-y-4 pb-4">
      <p class="text-sm text-text-muted">Resumen de solo lectura del estado de pago y participación que marcas manualmente en cada una de tus quinielas.</p>
      <p class="flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs text-text-muted" data-test="no-payments-note">
        <ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span>SportLeagues no cobra ni procesa pagos: no hay cobro automático, importes ni comisiones. Aquí solo ves el estado manual y solo de tus propias quinielas.</span>
      </p>

      <p v-if="!online" class="rounded-xl bg-warn-100 p-3 text-sm font-medium text-warn" role="status" data-test="offline-notice">Sin conexión: los conteos pueden no estar al día. Se actualizarán al volver a conectarte; pulsa Reintentar si ves un error.</p>

      <div v-if="finance.loading.value" class="flex items-center justify-center gap-2 py-12 text-sm text-text-muted" role="status"><LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />Comprobando tus organizaciones…</div>

      <ErrorState v-else-if="finance.error.value && !finance.tenants.value.length" :description="finance.error.value">
        <template #action><SecondaryButton @click="retry">Reintentar</SecondaryButton></template>
      </ErrorState>

      <EmptyState v-else-if="!finance.tenants.value.length" :icon="Wallet" title="Sin organizaciones administrables" description="Solo propietarios y administradores ven sus finanzas, y únicamente las de sus propias quinielas." />

      <template v-else>
        <label v-if="finance.tenants.value.length > 1" class="block text-sm font-semibold text-text">Organización
          <select :value="finance.selectedTenantId.value" class="field-surface mt-2 min-h-11 w-full px-3 py-3 text-sm" aria-label="Cambiar organización" @change="onTenantChange">
            <option v-for="tenant in finance.tenants.value" :key="tenant.tenant_id" :value="tenant.tenant_id">{{ tenantLabel(tenant) }}</option>
          </select>
        </label>
        <p v-else-if="finance.selectedTenant.value" class="text-sm font-semibold text-text">{{ tenantLabel(finance.selectedTenant.value) }}</p>

        <div v-if="finance.loadingTenant.value" class="flex items-center justify-center gap-2 py-10 text-sm text-text-muted" role="status"><LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" />Cargando quinielas…</div>

        <ErrorState v-else-if="finance.error.value" :description="finance.error.value">
          <template #action><SecondaryButton @click="retry">Reintentar</SecondaryButton></template>
        </ErrorState>

        <EmptyState v-else-if="!hasPools" :icon="Trophy" title="Esta organización aún no tiene quinielas" description="Cuando crees una quiniela y se inscriban participantes, aquí verás el estado manual de pago de cada una.">
          <template #action><SecondaryButton @click="router.push({ name: 'admin' })">Ir a mis quinielas</SecondaryButton></template>
        </EmptyState>

        <template v-else>
          <section class="app-surface space-y-3 p-4" aria-label="Resumen de la organización" data-test="finance-totals">
            <h2 class="font-display text-base font-bold text-text">Resumen de la organización</h2>
            <dl class="grid grid-cols-3 gap-2 text-center">
              <div class="flex flex-col-reverse rounded-xl bg-surface-2 p-2"><dt class="text-[11px] text-text-muted">Participantes</dt><dd class="font-display text-xl font-bold text-text" data-test="total-participants">{{ totals.total }}</dd></div>
              <div class="flex flex-col-reverse rounded-xl bg-surface-2 p-2"><dt class="text-[11px] text-text-muted">{{ PAYMENT_LABELS.paid }}</dt><dd class="font-display text-xl font-bold text-primary" data-test="total-paid">{{ totals.paid }}</dd></div>
              <div class="flex flex-col-reverse rounded-xl bg-surface-2 p-2"><dt class="text-[11px] text-text-muted">{{ PAYMENT_LABELS.pending }}</dt><dd class="font-display text-xl font-bold text-warn" data-test="total-pending">{{ totals.pending }}</dd></div>
              <div class="flex flex-col-reverse rounded-xl bg-surface-2 p-2"><dt class="text-[11px] text-text-muted">{{ PAYMENT_LABELS.invited }}</dt><dd class="font-display text-xl font-bold text-text" data-test="total-invited">{{ totals.invited }}</dd></div>
              <div class="flex flex-col-reverse rounded-xl bg-surface-2 p-2"><dt class="text-[11px] text-text-muted">Aprobados</dt><dd class="font-display text-xl font-bold text-text" data-test="total-approved">{{ totals.approved }}</dd></div>
              <div class="flex flex-col-reverse rounded-xl bg-surface-2 p-2"><dt class="text-[11px] text-text-muted">En espera</dt><dd class="font-display text-xl font-bold text-text" data-test="total-awaiting">{{ totals.awaitingApproval }}</dd></div>
            </dl>
            <p v-if="finance.summary.value.withdrawn" class="text-xs text-text-muted">{{ finance.summary.value.withdrawn }} participante(s) retirado(s) no se incluyen en estos conteos.</p>
            <p v-if="finance.truncated.value" class="rounded-xl bg-warn-100 p-3 text-xs font-medium text-warn" role="status">Hay demasiados participantes para mostrarlos todos aquí; los conteos pueden estar incompletos.</p>
          </section>

          <section aria-label="Estado por quiniela" class="space-y-3">
            <h2 class="font-display text-base font-bold text-text">Por quiniela</h2>
            <ul class="space-y-3">
              <li v-for="entry in finance.summary.value.byPool" :key="entry.pool.id" class="app-surface p-4" :data-test="`pool-${entry.pool.id}`">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="min-w-0 truncate font-semibold text-text">{{ entry.pool.name }}</h3>
                  <StatChip :label="POOL_STATUS_LABELS[entry.pool.status]" :tone="entry.pool.status === 'open' ? 'success' : 'neutral'" />
                </div>
                <p v-if="!entry.counts.total" class="mt-2 text-sm text-text-muted">Sin participantes todavía.</p>
                <dl v-else class="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-text-muted">
                  <div class="flex flex-col-reverse"><dt>Participantes</dt><dd class="font-display text-lg font-bold text-text">{{ entry.counts.total }}</dd></div>
                  <div class="flex flex-col-reverse"><dt>{{ PAYMENT_LABELS.paid }}</dt><dd class="font-display text-lg font-bold text-primary">{{ entry.counts.paid }}</dd></div>
                  <div class="flex flex-col-reverse"><dt>{{ PAYMENT_LABELS.pending }}</dt><dd class="font-display text-lg font-bold text-warn">{{ entry.counts.pending }}</dd></div>
                  <div class="flex flex-col-reverse"><dt>{{ PAYMENT_LABELS.invited }}</dt><dd class="font-display text-lg font-bold text-text">{{ entry.counts.invited }}</dd></div>
                  <div class="flex flex-col-reverse"><dt>Aprobados</dt><dd class="font-display text-lg font-bold text-text">{{ entry.counts.approved }}</dd></div>
                  <div class="flex flex-col-reverse"><dt>En espera</dt><dd class="font-display text-lg font-bold text-text">{{ entry.counts.awaitingApproval }}</dd></div>
                </dl>
              </li>
            </ul>
          </section>

          <SecondaryButton @click="router.push({ name: 'admin' })">Gestionar participantes y pagos manuales</SecondaryButton>
        </template>
      </template>
    </section>
  </AppShell>
</template>
