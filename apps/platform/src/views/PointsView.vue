<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Trophy, ChartNoAxesColumnIncreasing } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import EmptyState from '../components/EmptyState.vue'
import { useAuth } from '../composables/useAuth'
import { useMyPools } from '../composables/useMyPools'

const auth = useAuth()
const pools = useMyPools()
const router = useRouter()
onMounted(() => { void pools.load(auth.state.user?.id) })
</script>

<template>
  <AppShell variant="app" active="points" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Mis puntos" :back="{ name: 'home' }" />
    <section class="space-y-4" aria-label="Puntuación por quiniela">
      <p class="text-sm text-text-muted">Tus puntuaciones pertenecen a cada quiniela. No representan dinero ni ingresos por ventas.</p>
      <p v-if="pools.loading.value" role="status" class="text-sm text-text-muted">Cargando tus ligas…</p>
      <p v-else-if="pools.error.value" role="alert" class="text-sm text-danger">{{ pools.error.value }}</p>
      <template v-else-if="pools.pools.value.length">
        <section v-for="pool in pools.pools.value" :key="pool.id" class="app-surface space-y-2 p-4">
          <div class="flex items-center gap-2"><Trophy class="h-5 w-5 text-primary" aria-hidden="true" /><h2 class="font-display font-bold text-text">{{ pool.name }}</h2></div>
          <p class="text-sm text-text-muted">Puntuación y ranking pendientes de activación con el motor de scoring de Fase 08.</p>
          <button type="button" class="text-sm font-semibold text-primary underline underline-offset-4" @click="router.push({ name: 'pool', params: { poolId: pool.id } })">Ver quiniela</button>
        </section>
      </template>
      <EmptyState v-else :icon="ChartNoAxesColumnIncreasing" title="Todavía no participas en ligas" description="Únete a una quiniela para consultar aquí tus puntos cuando comience la competición." />
    </section>
  </AppShell>
</template>
