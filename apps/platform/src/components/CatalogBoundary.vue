<script setup lang="ts">
import ErrorState from './ErrorState.vue'
import LoadingSkeleton from './LoadingSkeleton.vue'
import SecondaryButton from './SecondaryButton.vue'

// Frontera de carga/error del catálogo deportivo: evita que una pantalla muestre "sin datos" o
// "no encontrado" mientras la fuente todavía está cargando.
withDefaults(defineProps<{ loading: boolean; failed?: boolean; rows?: number; rowHeight?: string }>(), { failed: false, rows: 3, rowHeight: '6.5rem' })
defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="loading" class="space-y-3" role="status" aria-live="polite" aria-label="Cargando">
    <LoadingSkeleton v-for="row in rows" :key="row" :height="rowHeight" rounded="rounded-2xl" />
    <span class="sr-only">Cargando…</span>
  </div>
  <ErrorState v-else-if="failed" description="No pudimos cargar esta sección. Revisa tu conexión e inténtalo de nuevo.">
    <template #action><SecondaryButton @click="$emit('retry')">Reintentar</SecondaryButton></template>
  </ErrorState>
  <slot v-else />
</template>
