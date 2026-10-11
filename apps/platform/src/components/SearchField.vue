<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'

defineProps<{ id: string; label: string; placeholder?: string }>()
const model = defineModel<string>({ default: '' })
defineEmits<{ submit: [] }>()
</script>

<template>
  <form role="search" class="relative" @submit.prevent="$emit('submit')">
    <label :for="id" class="sr-only">{{ label }}</label>
    <Search class="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
    <input
      :id="id"
      v-model="model"
      type="search"
      autocomplete="off"
      :placeholder="placeholder"
      class="field-surface w-full rounded-pill bg-surface-2/80 py-3 pl-11 pr-10 text-sm outline-none focus:border-primary [&::-webkit-search-cancel-button]:hidden"
    />
    <button v-if="model" type="button" class="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-text-muted hover:text-text" aria-label="Limpiar búsqueda" @click="model = ''">
      <X class="h-4 w-4" />
    </button>
  </form>
</template>
