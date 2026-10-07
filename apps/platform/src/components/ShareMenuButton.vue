<script setup lang="ts">
import { ref } from 'vue'
import { EllipsisVertical, Share2 } from 'lucide-vue-next'
import { shareLink } from '../lib/share'
import BottomSheet from './BottomSheet.vue'

const props = defineProps<{ title: string }>()
const open = ref(false)
const feedback = ref('')

async function share(): Promise<void> {
  const outcome = await shareLink({ title: props.title, url: window.location.href })
  feedback.value = outcome === 'copied' ? 'Enlace copiado.' : outcome === 'unsupported' ? 'Tu navegador no permite compartir este enlace.' : ''
  if (outcome === 'shared') open.value = false
}
</script>

<template>
  <button type="button" class="press-scale rounded-full p-2 text-text hover:bg-surface-2" aria-label="Más opciones" @click="open = true; feedback = ''">
    <EllipsisVertical class="h-5.5 w-5.5" />
  </button>
  <BottomSheet v-model:open="open" :title="title">
    <button type="button" class="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-text hover:bg-surface-2" @click="share">
      <Share2 class="h-5 w-5 text-primary" aria-hidden="true" />Compartir
    </button>
    <p v-if="feedback" class="mt-2 px-3 text-sm text-text-muted" role="status">{{ feedback }}</p>
  </BottomSheet>
</template>
