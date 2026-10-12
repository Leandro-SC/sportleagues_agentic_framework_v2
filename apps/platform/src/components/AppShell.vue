<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import BottomNav, { type NavKey } from './BottomNav.vue'
import TopBar from './TopBar.vue'
import { navModeForRoute, type NavMode } from '../lib/role-navigation'

// `app`: pantallas autenticadas con cabecera propia (ScreenHeader) y navegación inferior.
// `guest`: TopBar de marca para visitantes. `focus`: pantalla completa sin chrome, contenido centrado.
// `screen`: pantalla completa sin chrome ni relleno inferior; el contenido ocupa exactamente el alto
// del dispositivo (sin scroll de página mientras quepa), como una app nativa.
//
// La barra inferior es la del organizador cuando la ruta pertenece a la experiencia `admin`
// (/organizador y /admin/**, ver lib/role-navigation.ts); en cualquier otra ruta es la del
// participante. `nav` permite forzarla, pero por defecto se deduce de la ruta.
const props = withDefaults(
  defineProps<{
    variant?: 'guest' | 'app' | 'focus' | 'screen'
    active?: NavKey
    title?: string
    userName?: string | null
    nav?: NavMode
  }>(),
  { variant: 'guest', active: 'home' },
)

const route = useRoute()
const navMode = computed<NavMode>(() => props.nav ?? navModeForRoute(route?.name))
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-lg flex-col bg-canvas">
    <TopBar v-if="variant === 'guest'" variant="guest" :title="title" :user-name="userName" />
    <main class="flex-1 px-5" :class="variant === 'focus' ? 'safe-top flex items-center justify-center pb-8' : variant === 'screen' ? 'safe-top flex flex-col' : variant === 'guest' ? 'pt-1 pb-8' : 'pb-8'">
      <div class="w-full" :class="variant === 'screen' ? 'flex flex-1 flex-col' : ''">
        <slot />
      </div>
    </main>
    <BottomNav v-if="variant === 'app'" :active="active" :mode="navMode" />
  </div>
</template>
