<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChartNoAxesColumnIncreasing, Flame, Trophy } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import LoadingSkeleton from '../components/LoadingSkeleton.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import StatChip from '../components/StatChip.vue'
import { useAuth } from '../composables/useAuth'
import { usePoolStats } from '../composables/usePoolStats'

const auth = useAuth()
const stats = usePoolStats()
const router = useRouter()
onMounted(() => { void stats.loadSummary() })
</script>

<template>
  <AppShell variant="app" active="points" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Mis puntos" :back="{ name: 'home' }" />
    <section class="space-y-4" aria-label="Puntuación por quiniela">
      <p class="text-sm text-text-muted">Tus puntos pertenecen a cada quiniela y no se suman entre ellas. No representan dinero.</p>
      <div v-if="stats.loading.value" class="space-y-3" role="status" aria-label="Cargando tus puntos"><LoadingSkeleton height="5rem" /><LoadingSkeleton height="5rem" /></div>
      <ErrorState v-else-if="stats.error.value" :description="stats.error.value" />
      <template v-else-if="stats.summary.value.length">
        <button
          v-for="row in stats.summary.value" :key="row.pool_id" type="button"
          class="app-surface flex w-full items-center justify-between gap-3 p-4 text-left"
          @click="router.push({ name: 'pool', params: { poolId: row.pool_id } })"
        >
          <span class="min-w-0">
            <span class="flex items-center gap-2 font-display font-bold text-text"><Trophy class="h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><span class="truncate">{{ row.pool_name }}</span></span>
            <span class="mt-1 flex flex-wrap gap-2">
              <StatChip :label="`#${row.rank} de ${row.participants}`" tone="brand" />
              <StatChip :label="`${row.exact_hits} exactos`" />
              <StatChip v-if="row.current_streak > 0" :label="`Racha ${row.current_streak}`" :icon="Flame" tone="success" />
            </span>
          </span>
          <span class="text-right"><span class="block font-display text-2xl font-bold text-primary">{{ row.points }}</span><span class="text-xs text-text-muted">puntos</span></span>
        </button>
      </template>
      <EmptyState v-else :icon="ChartNoAxesColumnIncreasing" title="Todavía no tienes puntos" description="Únete a una quiniela y pronostica: tus puntos y tu posición aparecerán aquí cuando el organizador publique resultados." />
    </section>
  </AppShell>
</template>
