<script setup lang="ts">
import BottomNav, { type NavKey } from './BottomNav.vue'
import TopBar from './TopBar.vue'

// `app`: pantallas autenticadas con cabecera propia (ScreenHeader) y navegación inferior.
// `guest`: TopBar de marca para visitantes. `focus`: pantalla completa sin chrome, contenido centrado.
// `screen`: pantalla completa sin chrome ni relleno inferior; el contenido ocupa exactamente el alto
// del dispositivo (sin scroll de página mientras quepa), como una app nativa.
withDefaults(
  defineProps<{
    variant?: 'guest' | 'app' | 'focus' | 'screen'
    active?: NavKey
    title?: string
    userName?: string | null
  }>(),
  { variant: 'guest', active: 'home' },
)
</script>

<template>
  <div class="mx-auto flex min-h-dvh max-w-lg flex-col bg-canvas">
    <TopBar v-if="variant === 'guest'" variant="guest" :title="title" :user-name="userName" />
    <main class="flex-1 px-5" :class="variant === 'focus' ? 'safe-top flex items-center justify-center pb-8' : variant === 'screen' ? 'safe-top flex flex-col' : variant === 'guest' ? 'pt-1 pb-8' : 'pb-8'">
      <div class="w-full" :class="variant === 'screen' ? 'flex flex-1 flex-col' : ''">
        <slot />
      </div>
    </main>
    <BottomNav v-if="variant === 'app'" :active="active" />
  </div>
</template>
