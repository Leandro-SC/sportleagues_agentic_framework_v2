<script setup lang="ts">
import { ref } from 'vue'
import { Share2 } from 'lucide-vue-next'
import SecondaryButton from './SecondaryButton.vue'
import { renderFlyer, type FlyerInput } from '../lib/flyer'
import { shareImage } from '../lib/share'

// Genera el flyer en el dispositivo y lo comparte con el menú nativo (o lo descarga). No sube nada a ningún servicio.
const props = defineProps<{ input: FlyerInput; filename: string; title: string; label?: string }>()
const busy = ref(false)
const notice = ref('')

async function share(): Promise<void> {
  busy.value = true
  notice.value = ''
  try {
    const blob = await renderFlyer(props.input)
    if (!blob) { notice.value = 'Tu navegador no puede generar la imagen.'; return }
    const outcome = await shareImage({ blob, filename: props.filename, title: props.title })
    notice.value = outcome === 'downloaded' ? 'Imagen descargada.' : outcome === 'unsupported' ? 'No se pudo compartir en este dispositivo.' : ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <SecondaryButton :loading="busy" @click="share"><Share2 class="h-4 w-4" aria-hidden="true" />{{ label ?? 'Compartir' }}</SecondaryButton>
    <p v-if="notice" class="mt-1 text-center text-xs text-text-muted" role="status">{{ notice }}</p>
  </div>
</template>
