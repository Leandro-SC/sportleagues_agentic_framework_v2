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
      <div class="stadium-hero flex flex-col items-center gap-3 rounded-3xl border border-secondary/25 p-6 text-center shadow-md">
        <span class="flex h-20 w-20 items-center justify-center rounded-full border border-primary/50 bg-surface-2 font-display text-2xl font-bold text-primary shadow-glow-primary">{{ initials }}</span>
        <h1 class="text-lg font-bold text-text">{{ auth.state.profile?.display_name ?? 'Sin nombre' }}</h1>
        <p class="flex items-center gap-1.5 text-sm text-text-muted"><Mail class="h-4 w-4" />{{ auth.state.user?.email }}</p>
      </div>

      <div class="app-surface p-4">
        <div class="flex items-center gap-3 px-1 py-2 text-sm text-text-muted">
          <User class="h-4 w-4 text-text-faint" />
          <span>Cuenta verificada con Supabase Auth</span>
        </div>
      </div>

      <p v-if="error" class="text-sm font-medium text-danger" role="alert">{{ error }}</p>
      <SecondaryButton tone="danger" :loading="loggingOut" @click="logout">
        <LogOut class="h-4 w-4" />
        Cerrar sesión
      </SecondaryButton>
    </section>
  </AppShell>
</template>
