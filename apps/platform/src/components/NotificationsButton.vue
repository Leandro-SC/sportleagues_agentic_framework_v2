<script setup lang="ts">
import { ref } from 'vue'
import { Bell, BellOff } from 'lucide-vue-next'
import BottomSheet from './BottomSheet.vue'
import EmptyState from './EmptyState.vue'

// Las notificaciones base pertenecen a Fase 11; aquí solo existe el punto de entrada con su estado vacío.
const open = ref(false)
</script>

<template>
  <button type="button" class="press-scale icon-button" aria-label="Notificaciones" @click="open = true">
    <Bell class="h-5.5 w-5.5" />
  </button>
  <BottomSheet v-model:open="open" title="Notificaciones">
    <EmptyState :icon="BellOff" title="No tienes notificaciones" description="Aquí verás avisos de cierres de pronóstico y resultados cuando se habiliten." />
  </BottomSheet>
</template>
