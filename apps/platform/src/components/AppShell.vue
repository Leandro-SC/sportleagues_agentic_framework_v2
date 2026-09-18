<script setup lang="ts">
import { KeyRound } from 'lucide-vue-next'
import BottomNav from './BottomNav.vue'
import JoinCodeSheet from './JoinCodeSheet.vue'
import TopBar from './TopBar.vue'

withDefaults(
  defineProps<{
    variant?: 'guest' | 'app' | 'focus'
    active?: 'home' | 'profile'
    title?: string
    userName?: string | null
  }>(),
  { variant: 'guest', active: 'home' },
)

const joinOpen = defineModel<boolean>('joinOpen', { default: false })
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-lg flex-col">
    <TopBar v-if="variant !== 'focus'" :variant="variant === 'app' ? 'app' : 'guest'" :title="title" :user-name="userName" />
    <main class="flex-1 px-5 pb-8" :class="variant === 'focus' ? 'safe-top flex items-center justify-center' : 'pt-1'">
      <div class="w-full">
        <slot />
      </div>
    </main>
    <button
      v-if="variant === 'app'"
      type="button"
      class="press-scale fixed bottom-20 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg"
      aria-label="Unirme con código"
      @click="joinOpen = true"
    >
      <KeyRound class="h-6 w-6" />
    </button>
    <BottomNav v-if="variant === 'app'" :active="active" />
    <JoinCodeSheet v-model:open="joinOpen" />
  </div>
</template>
