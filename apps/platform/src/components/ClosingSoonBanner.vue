<script setup lang="ts">
import { computed } from 'vue'
import { BellRing } from 'lucide-vue-next'

// Aviso dentro de la app de cierres próximos (los textos usan el cierre que calcula el servidor). Es una ayuda: el servidor rechaza
// cualquier guardado posterior al cierre aunque el reloj del dispositivo esté desfasado.
export type ClosingItem = { key: string; label: string; closesAt: string }
const props = withDefaults(defineProps<{ items: ClosingItem[]; now: Date; withinMinutes?: number }>(), { withinMinutes: 60 })

const soon = computed(() => props.items
  .map((item) => ({ ...item, minutes: Math.ceil((new Date(item.closesAt).getTime() - props.now.getTime()) / 60_000) }))
  .filter((item) => item.minutes > 0 && item.minutes <= props.withinMinutes)
  .sort((a, b) => a.minutes - b.minutes))
</script>

<template>
  <aside v-if="soon.length" class="flex gap-3 rounded-xl border border-warn/30 bg-warn-100/60 px-3.5 py-3 text-sm text-text-muted" role="status" aria-live="polite">
    <BellRing class="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
    <div class="min-w-0">
      <p class="font-semibold text-text">{{ soon.length === 1 ? 'Un cierre próximo' : `${soon.length} cierres próximos` }}</p>
      <ul class="mt-1 space-y-0.5">
        <li v-for="item in soon.slice(0, 3)" :key="item.key" class="truncate">{{ item.label }} · cierra en {{ item.minutes }} min</li>
      </ul>
    </div>
  </aside>
</template>
