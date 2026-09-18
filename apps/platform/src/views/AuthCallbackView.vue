<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ErrorState from '../components/ErrorState.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { useJoinPool } from '../composables/useJoinPool'

const router = useRouter()
const auth = useAuth()
const joiner = useJoinPool()
const error = ref('')

onMounted(async () => {
  const result = await auth.completeCallback()
  if (result) { error.value = result; return }
  if (!auth.state.profile) { await router.replace({ name: 'onboarding' }); return }
  const participant = await joiner.resumeIntent()
  await router.replace(participant ? { name: 'pool', params: { poolId: participant.pool_id } } : { name: 'home' })
})
</script>

<template>
  <AppShell variant="focus">
    <section class="w-full space-y-5 text-center">
      <template v-if="!error">
        <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <LoaderCircle class="h-7 w-7 animate-spin" />
        </span>
        <div>
          <h1 class="font-display text-xl font-bold text-ink-950">Completando inicio de sesión</h1>
          <p class="mt-1 text-sm text-ink-500">Espera un momento…</p>
        </div>
      </template>
      <ErrorState v-else :description="error">
        <template #action><SecondaryButton @click="router.push({ name: 'home' })">Volver al inicio</SecondaryButton></template>
      </ErrorState>
    </section>
  </AppShell>
</template>
