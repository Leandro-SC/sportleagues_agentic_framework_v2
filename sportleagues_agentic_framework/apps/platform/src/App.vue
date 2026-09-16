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
  <div v-if="!configured" class="mx-auto flex min-h-screen max-w-lg items-center p-5">
    <section class="w-full rounded-2xl border border-warn-100 bg-warn-100/60 p-5">
      <h1 class="font-display font-semibold text-ink-950">Configuración pendiente</h1>
      <p class="mt-1 text-sm text-ink-600">Configura las variables públicas de Supabase para iniciar la aplicación.</p>
    </section>
  </div>
  <!-- Shown only while the async router guard for /admin or /superadmin resolves its role
       check (e.g. a direct refresh), so neither route ever flashes privileged content while
       waiting on the network round trip. -->
  <div v-else-if="routeAuthCheck === 'superadmin'" class="flex min-h-screen items-center justify-center bg-ink-950">
    <LoaderCircle class="h-5 w-5 animate-spin text-mist-400" aria-hidden="true" />
  </div>
  <div v-else-if="routeAuthCheck === 'admin'" class="flex min-h-screen items-center justify-center bg-mist-50">
    <LoaderCircle class="h-5 w-5 animate-spin text-ink-400" aria-hidden="true" />
  </div>
  <RouterView v-else />
</template>
