<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, BellOff, CheckCheck } from 'lucide-vue-next'
import BottomSheet from './BottomSheet.vue'
import EmptyState from './EmptyState.vue'
import { relativeTime, useNotifications, type AppNotification } from '../composables/useNotifications'

// Avisos de resultados publicados o corregidos en las quinielas del usuario (ADR-025).
const router = useRouter()
const notifications = useNotifications()
const open = ref(false)
const badge = computed(() => (notifications.unread.value > 9 ? '9+' : String(notifications.unread.value)))
const label = computed(() => (notifications.unread.value ? `Notificaciones, ${notifications.unread.value} sin leer` : 'Notificaciones'))

async function openItem(item: AppNotification): Promise<void> {
  open.value = false
  if (!item.read_at) void notifications.markRead([item.id])
  await router.push({ name: 'pool', params: { poolId: item.pool_id } })
}
</script>

<template>
  <button type="button" class="press-scale icon-button relative" :aria-label="label" data-testid="notifications-button" @click="open = true">
    <Bell class="h-5.5 w-5.5" />
    <span v-if="notifications.unread.value" class="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-bold text-white" data-testid="notifications-badge" aria-hidden="true">{{ badge }}</span>
  </button>
  <BottomSheet v-model:open="open" title="Notificaciones">
    <div class="space-y-3">
      <div v-if="notifications.unread.value" class="flex justify-end">
        <button type="button" class="press-scale flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary" data-testid="notifications-mark-all" @click="notifications.markRead()"><CheckCheck class="h-4 w-4" aria-hidden="true" />Marcar todo como leído</button>
      </div>
      <p v-if="notifications.error.value" class="rounded-xl bg-danger-100 p-3 text-sm text-danger" role="alert">{{ notifications.error.value }}</p>
      <EmptyState v-if="!notifications.items.value.length && !notifications.loading.value" :icon="BellOff" title="No tienes notificaciones" description="Te avisaremos aquí cuando se publique o se corrija el resultado de un partido de tus quinielas." />
      <ul v-else class="space-y-2">
        <li v-for="item in notifications.items.value" :key="item.id">
          <button type="button" class="press-scale flex w-full items-start gap-3 rounded-xl border p-3 text-left" :class="item.read_at ? 'border-border bg-surface' : 'border-primary/40 bg-surface-2'" @click="openItem(item)">
            <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" :class="item.read_at ? 'bg-transparent' : 'bg-primary'" aria-hidden="true" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-semibold text-text">{{ item.title }}</span>
              <span class="mt-0.5 block text-sm text-text-muted">{{ item.body }}</span>
              <span class="mt-1 block text-xs text-text-faint">{{ relativeTime(item.created_at) }}<span v-if="!item.read_at" class="sr-only"> · sin leer</span></span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </BottomSheet>
</template>
