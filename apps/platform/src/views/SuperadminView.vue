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
        <h1 class="font-display text-xl font-bold text-white">Administración de plataforma</h1>
        <p class="mt-1 text-sm text-mist-400">SportLeagues</p>
      </div>

      <div class="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success-500/15 text-success-500">
          <ShieldCheck class="h-5 w-5" />
        </span>
        <div>
          <p class="text-sm font-semibold text-white">Sesión verificada como Superadmin.</p>
          <p class="mt-1 text-sm text-mist-400">Este entorno es independiente del panel de organizador. Los módulos de tenants, planes y auditoría se habilitarán en fases posteriores.</p>
        </div>
      </div>
    </section>
  </SuperadminShell>
</template>
