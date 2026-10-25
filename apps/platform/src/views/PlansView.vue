<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Check, Crown, LoaderCircle } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import { useAuth } from '../composables/useAuth'
import { formatPlanPrice, usePlanCatalog } from '../composables/usePlanCatalog'

const auth = useAuth()
const plans = usePlanCatalog()
const selectedPool = ref<Record<string, string>>({})
onMounted(() => { void plans.load(auth.state.user?.id) })
</script>

<template>
  <AppShell :variant="auth.isAuthenticated.value ? 'app' : 'screen'" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Planes" :back="true" />
    <section class="space-y-4 pb-8">
      <p class="text-sm text-text-muted">Elige el plan que acompaña a tu organización. Los precios son referenciales y pueden actualizarse desde la plataforma; solicitar PRO no genera un cobro automático.</p>
      <p v-if="plans.loading.value" class="flex items-center gap-2 text-sm text-text-muted"><LoaderCircle class="h-4 w-4 animate-spin" />Cargando planes…</p>
      <article v-for="plan in plans.offers.value" :key="plan.offer_code" class="app-surface space-y-4 p-5" :class="plan.plan_code === 'pro' ? 'border border-primary/30' : ''">
        <div class="flex items-start justify-between gap-3"><div><h2 class="font-display text-xl font-bold text-text">{{ plan.offer_code === 'pro_annual' ? 'PRO anual' : plan.offer_code === 'pro_single_pool' ? 'PRO por quiniela' : plan.plan_code === 'pro' ? 'PRO mensual' : 'FREE' }}</h2><p class="text-sm text-text-muted">{{ plan.plan_code === 'pro' ? 'Para organizadores que quieren una experiencia propia.' : 'Para empezar una quiniela.' }}</p></div><Crown v-if="plan.plan_code === 'pro'" class="h-6 w-6 text-primary" /></div>
        <p class="font-display text-3xl font-bold text-primary">{{ formatPlanPrice(plan) }}</p>
        <ul class="space-y-2 text-sm text-text-muted"><li v-for="benefit in plan.benefits" :key="benefit" class="flex gap-2"><Check class="mt-0.5 h-4 w-4 shrink-0 text-primary" />{{ benefit }}</li></ul>
        <template v-if="plan.plan_code === 'pro' && auth.isAuthenticated.value">
          <div v-if="plans.tenants.value.length" class="space-y-2">
            <template v-for="tenant in plans.tenants.value" :key="tenant.tenant_id"><label v-if="plan.scope === 'single_pool'" class="block text-sm font-medium text-text-muted">Quiniela
              <select v-model="selectedPool[`${plan.offer_code}-${tenant.tenant_id}`]" class="field-surface mt-1 w-full px-3 py-2"><option value="">Selecciona una quiniela</option><option v-for="pool in plans.pools.value.filter((item) => item.tenant_id === tenant.tenant_id)" :key="pool.id" :value="pool.id">{{ pool.name }}</option></select>
            </label><PrimaryButton :loading="plans.requesting.value" @click="plans.requestPro(tenant.tenant_id, plan, selectedPool[`${plan.offer_code}-${tenant.tenant_id}`] ?? null)">Solicitar {{ plan.offer_code === 'pro_annual' ? 'PRO anual' : plan.offer_code === 'pro_single_pool' ? 'PRO por quiniela' : 'PRO mensual' }} para {{ tenant.name }}</PrimaryButton></template>
          </div>
          <p v-else class="text-sm text-text-muted">Cuando seas organizador podrás solicitar PRO para tu propia organización.</p>
        </template>
      </article>
      <p v-if="plans.notice.value" class="rounded-xl bg-primary-100 p-3 text-sm font-medium text-primary" role="status">{{ plans.notice.value }}</p>
      <p v-if="plans.error.value" class="rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger" role="alert">{{ plans.error.value }}</p>
    </section>
  </AppShell>
</template>
