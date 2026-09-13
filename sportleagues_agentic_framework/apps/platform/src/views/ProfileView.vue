<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { LogOut, Mail, User } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const auth = useAuth()
const loggingOut = ref(false)
const error = ref('')

const initials = computed(() => {
  const name = auth.state.profile?.display_name?.trim()
  if (!name) return '?'
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
})

async function logout(): Promise<void> {
  loggingOut.value = true
  const result = await auth.signOut()
  loggingOut.value = false
  if (result) { error.value = result; return }
  await router.replace({ name: 'home' })
}
</script>

<template>
  <AppShell variant="app" active="profile" title="Perfil" :user-name="auth.state.profile?.display_name">
    <section class="space-y-6 pt-2">
      <div class="flex flex-col items-center gap-3 rounded-2xl border border-mist-200 bg-white p-6 text-center shadow-sm">
        <span class="flex h-16 w-16 items-center justify-center rounded-full bg-ink-900 font-display text-xl font-bold text-white">{{ initials }}</span>
        <h1 class="text-lg font-bold text-ink-950">{{ auth.state.profile?.display_name ?? 'Sin nombre' }}</h1>
        <p class="flex items-center gap-1.5 text-sm text-ink-500"><Mail class="h-4 w-4" />{{ auth.state.user?.email }}</p>
      </div>

      <div class="rounded-2xl border border-mist-200 bg-white p-4 shadow-sm">
        <div class="flex items-center gap-3 px-1 py-2 text-sm text-ink-600">
          <User class="h-4 w-4 text-ink-400" />
          <span>Cuenta verificada con Supabase Auth</span>
        </div>
      </div>

      <p v-if="error" class="text-sm font-medium text-danger-600" role="alert">{{ error }}</p>
      <SecondaryButton tone="danger" :loading="loggingOut" @click="logout">
        <LogOut class="h-4 w-4" />
        Cerrar sesión
      </SecondaryButton>
    </section>
  </AppShell>
</template>
