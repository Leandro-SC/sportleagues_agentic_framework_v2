<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { KeyRound, LoaderCircle } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import ErrorState from '../components/ErrorState.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { useJoinPool } from '../composables/useJoinPool'
import { normalizeJoinCode, saveJoinIntent } from '../lib/join-intent'

const props = defineProps<{ code: string }>()
const router = useRouter()
const auth = useAuth()
const joiner = useJoinPool()
const status = ref('')

async function continueJoin(): Promise<void> {
  const code = normalizeJoinCode(props.code)
  if (!code) { status.value = 'El código de unión no es válido.'; return }
  try { saveJoinIntent(code) } catch (error) { status.value = error instanceof Error ? error.message : 'No fue posible continuar.'; return }
  await auth.restore()
  if (!auth.isAuthenticated.value) { status.value = 'Inicia sesión para continuar con la unión.'; await router.push({ name: 'home' }); return }
  if (!auth.state.profile) { await router.push({ name: 'onboarding' }); return }
  const participant = await joiner.resumeIntent()
  if (participant) { status.value = participant.approval_status === 'pending' ? 'Tu solicitud quedó pendiente de aprobación.' : 'Tu participación fue confirmada.'; await router.push({ name: 'pool', params: { poolId: participant.pool_id } }) }
}

onMounted(() => { void continueJoin() })
</script>

<template>
  <AppShell variant="focus">
    <section class="w-full space-y-5 text-center">
      <template v-if="joiner.loading.value || (!status && !joiner.error.value)">
        <span class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <KeyRound class="h-7 w-7" />
        </span>
        <div>
          <h1 class="font-display text-xl font-bold text-ink-950">Uniéndote a la quiniela</h1>
          <p class="mt-1 flex items-center justify-center gap-2 text-sm text-ink-500"><LoaderCircle class="h-4 w-4 animate-spin" />Validando tu acceso…</p>
        </div>
      </template>
      <ErrorState v-if="joiner.error.value" :description="joiner.error.value">
        <template #action><SecondaryButton @click="router.push({ name: 'home' })">Volver al inicio</SecondaryButton></template>
      </ErrorState>
      <p v-else-if="status" class="rounded-xl bg-success-100 p-4 text-sm font-medium text-success-600">{{ status }}</p>
    </section>
  </AppShell>
</template>
