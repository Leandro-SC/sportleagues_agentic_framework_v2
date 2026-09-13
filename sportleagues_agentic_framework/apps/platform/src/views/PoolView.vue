<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ErrorState from '../components/ErrorState.vue'
import MatchCard from '../components/MatchCard.vue'
import PoolCard from '../components/PoolCard.vue'
import RankingRow from '../components/RankingRow.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import { usePoolAccess } from '../composables/usePoolAccess'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const access = usePoolAccess()

watch(
  () => route.params.poolId,
  (poolId) => { void access.load(typeof poolId === 'string' ? poolId : '') },
  { immediate: true },
)
</script>

<template>
  <AppShell variant="app" active="home" title="Quiniela" :user-name="auth.state.profile?.display_name">
    <section class="space-y-6 pt-2">
      <div v-if="access.loading.value" class="flex items-center justify-center gap-2 py-16 text-sm text-ink-500">
        <LoaderCircle class="h-4 w-4 animate-spin" />Verificando acceso…
      </div>

      <template v-else-if="access.pool.value">
        <PoolCard :name="access.pool.value.name" variant="hero" status="active" />

        <div>
          <h2 class="mb-3 font-display text-base font-bold text-ink-950">Próximos partidos</h2>
          <div class="space-y-3">
            <MatchCard skeleton />
            <MatchCard skeleton />
          </div>
          <p class="mt-2 text-center text-xs text-ink-400">Los partidos y jornadas se habilitan en la Fase 06.</p>
        </div>

        <div>
          <h2 class="mb-3 font-display text-base font-bold text-ink-950">Ranking</h2>
          <div class="space-y-1.5 rounded-2xl border border-mist-200 bg-white p-3">
            <RankingRow skeleton />
            <RankingRow skeleton />
            <RankingRow skeleton />
          </div>
          <p class="mt-2 text-center text-xs text-ink-400">El leaderboard se habilita en la Fase 08.</p>
        </div>
      </template>

      <ErrorState v-else-if="access.denied.value" tone="denied" description="No tienes acceso a esta quiniela.">
        <template #action><SecondaryButton @click="router.push({ name: 'home' })">Volver al inicio</SecondaryButton></template>
      </ErrorState>

      <ErrorState v-else-if="access.error.value" description="No fue posible verificar el acceso." />
    </section>
  </AppShell>
</template>
