<script setup lang="ts">
import BottomNav, { type NavKey } from './BottomNav.vue'
import TopBar from './TopBar.vue'

// `app`: pantallas autenticadas con cabecera propia (ScreenHeader) y navegación inferior.
// `guest`: TopBar de marca para visitantes. `focus`: pantalla completa sin chrome.
withDefaults(
  defineProps<{
    variant?: 'guest' | 'app' | 'focus'
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
    <main class="flex-1 px-5 pb-8" :class="variant === 'focus' ? 'safe-top flex items-center justify-center' : variant === 'guest' ? 'pt-1' : ''">
      <div class="w-full">
        <slot />
      </div>
    </main>
    <BottomNav v-if="variant === 'app'" :active="active" />
  </div>
</template>
