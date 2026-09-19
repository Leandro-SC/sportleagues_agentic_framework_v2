<script setup lang="ts">
import { useRouter } from 'vue-router'
import { ShieldCheck } from 'lucide-vue-next'
import SuperadminShell from '../components/SuperadminShell.vue'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const auth = useAuth()

async function handleLogout(): Promise<void> {
  await auth.signOut()
  await router.replace({ name: 'home' })
}
</script>

<template>
  <SuperadminShell :user-name="auth.state.user?.email" @logout="handleLogout">
    <section class="space-y-6">
      <div>
        <h1 class="font-display text-xl font-bold text-text">Administración de plataforma</h1>
        <p class="mt-1 text-sm text-text-muted">SportLeagues</p>
      </div>

      <div class="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
        <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary">
          <ShieldCheck class="h-5 w-5" />
        </span>
        <div>
          <p class="text-sm font-semibold text-text">Sesión verificada como Superadmin.</p>
          <p class="mt-1 text-sm text-text-muted">Este entorno es independiente del panel de organizador. Los módulos de tenants, planes y auditoría se habilitarán en fases posteriores.</p>
        </div>
      </div>
    </section>
  </SuperadminShell>
</template>
