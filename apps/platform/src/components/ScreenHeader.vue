<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { useRouter, type RouteLocationRaw } from 'vue-router'

const props = withDefaults(defineProps<{ title?: string; back?: RouteLocationRaw | true | null; large?: boolean }>(), { back: null, large: false })
const router = useRouter()

function goBack(): void {
  if (props.back === true) {
    if (window.history.length > 1) router.back()
    else void router.push({ name: 'home' })
    return
  }
  if (props.back) void router.push(props.back)
}
</script>

<template>
  <header class="safe-top flex items-center gap-3 pb-3 pt-4">
    <button v-if="back" type="button" class="press-scale -ml-1.5 rounded-full p-1.5 text-text hover:bg-surface-2" aria-label="Volver" @click="goBack">
      <ArrowLeft class="h-6 w-6" />
    </button>
    <h1 v-if="title" class="min-w-0 flex-1 truncate font-display font-bold text-text" :class="large ? 'text-[26px]' : 'text-lg'">{{ title }}</h1>
    <div v-else class="flex-1" />
    <div v-if="$slots.actions" class="flex items-center gap-1"><slot name="actions" /></div>
  </header>
</template>
