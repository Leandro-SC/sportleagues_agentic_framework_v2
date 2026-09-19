<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '../components/AppShell.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import { useAuth } from '../composables/useAuth'
import { useJoinPool } from '../composables/useJoinPool'

const router = useRouter()
const auth = useAuth()
const joiner = useJoinPool()
const displayName = ref('')
const error = ref('')
const saving = ref(false)

const initials = computed(() => {
  const name = displayName.value.trim()
  if (!name) return '?'
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
})

async function submit(): Promise<void> {
  saving.value = true; error.value = ''
  const result = await auth.saveProfile(displayName.value)
  saving.value = false
  if (result) { error.value = result; return }
  const participant = await joiner.resumeIntent()
  await router.replace(participant ? { name: 'pool', params: { poolId: participant.pool_id } } : { name: 'home' })
}
</script>

<template>
  <AppShell variant="focus">
    <section class="w-full space-y-6">
      <div class="flex flex-col items-center gap-3 text-center">
        <span class="flex h-16 w-16 items-center justify-center rounded-full bg-primary font-display text-xl font-bold text-canvas shadow-glow-primary">{{ initials }}</span>
        <div>
          <h1 class="font-display text-xl font-bold text-text">Completa tu perfil</h1>
          <p class="mt-1 text-sm text-text-muted">Usaremos este nombre para mostrarte en tus quinielas.</p>
        </div>
      </div>
      <form class="space-y-4 app-surface-raised p-5" @submit.prevent="submit">
        <FormField id="display-name" v-model="displayName" label="Nombre para mostrar" :maxlength="80" required placeholder="Como quieres que te vean" />
        <PrimaryButton type="submit" :loading="saving">Continuar</PrimaryButton>
      </form>
      <p v-if="error" class="text-center text-sm font-medium text-danger" role="alert">{{ error }}</p>
    </section>
  </AppShell>
</template>
