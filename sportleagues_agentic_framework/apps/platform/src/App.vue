<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { hasSupabaseConfiguration } from './lib/supabase'
import { useAuth } from './composables/useAuth'

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
  <RouterView v-else />
</template>
