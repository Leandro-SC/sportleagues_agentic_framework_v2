<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { LoaderCircle } from 'lucide-vue-next'
import { hasSupabaseConfiguration } from './lib/supabase'
import { useAuth } from './composables/useAuth'
import { routeAuthCheck } from './router'

const configured = hasSupabaseConfiguration()
const auth = configured ? useAuth() : null
onMounted(() => { if (auth) void auth.restore() })
</script>

<template>
  <div v-if="!configured" class="mx-auto flex min-h-screen max-w-lg items-center bg-canvas p-5">
    <section class="w-full rounded-2xl border border-warn/30 bg-warn-100/60 p-5">
      <h1 class="font-display font-semibold text-text">Configuración pendiente</h1>
      <p class="mt-1 text-sm text-text-muted">Configura las variables públicas de Supabase para iniciar la aplicación.</p>
    </section>
  </div>
  <!-- Shown only while the async router guard for /admin or /superadmin resolves its role
       check (e.g. a direct refresh), so neither route ever flashes privileged content while
       waiting on the network round trip. -->
  <div v-else-if="routeAuthCheck === 'superadmin'" class="flex min-h-screen items-center justify-center bg-canvas">
    <LoaderCircle class="h-5 w-5 animate-spin text-text-muted" aria-hidden="true" />
  </div>
  <div v-else-if="routeAuthCheck === 'admin'" class="flex min-h-screen items-center justify-center bg-canvas">
    <LoaderCircle class="h-5 w-5 animate-spin text-text-muted" aria-hidden="true" />
  </div>
  <RouterView v-else />
</template>
