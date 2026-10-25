<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Copy, Download, ImagePlus, MessageCircle, Share2, X } from 'lucide-vue-next'
import BottomSheet from './BottomSheet.vue'
import PrimaryButton from './PrimaryButton.vue'
import SecondaryButton from './SecondaryButton.vue'
import { loadFlyerImage, renderFlyer, type FlyerFormat, type FlyerInput, type FlyerLogo } from '../lib/flyer'
import { readLocalImage } from '../lib/local-image'
import { buildShareMessage } from '../lib/share-messages'
import { shareImage, shareToWhatsApp } from '../lib/share'
import type { TenantBranding } from '../composables/useTenantBranding'

// Centro para compartir pensado para WhatsApp: plantillas con datos reales de la quiniela, formato chat (4:5) o Estado (9:16),
// foto de fondo propia (se procesa en el teléfono y no se sube), mensaje editable y envío por el menú del sistema o wa.me.
export type ShareTemplate = { id: string; label: string; input: FlyerInput; filename: string; qrUrl?: string | null; qrLabel?: string }

const props = withDefaults(defineProps<{ templates: ShareTemplate[]; branding?: TenantBranding | null; link?: string | null; buttonLabel?: string }>(), {
  branding: null, link: null, buttonLabel: 'Compartir',
})

const open = ref(false)
const selectedId = ref('')
const format = ref<FlyerFormat>('chat')
const background = ref<FlyerLogo | null>(null)
const logo = ref<FlyerLogo | null>(null)
const message = ref('')
const previewUrl = ref('')
const rendering = ref(false)
const sharing = ref(false)
const notice = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
let renderToken = 0

const selected = computed(() => props.templates.find((template) => template.id === selectedId.value) ?? props.templates[0] ?? null)
const extras = computed(() => ({
  brand: props.branding ? { plan: props.branding.plan, accent: props.branding.accent, logo: logo.value, orgName: props.branding.brandName } : undefined,
  qrUrl: selected.value?.qrUrl ?? null,
  qrLabel: selected.value?.qrLabel,
  format: format.value,
  background: background.value,
}))
const filename = computed(() => {
  const base = selected.value?.filename ?? 'quiniela'
  return `${base}${format.value === 'status' ? '-estado' : ''}${background.value ? '.jpg' : '.png'}`
})

function resetMessage(): void {
  message.value = selected.value ? buildShareMessage(selected.value.input, { brandName: props.branding?.brandName, link: props.link }) : ''
}

async function openStudio(): Promise<void> {
  if (!props.templates.length) return
  if (!props.templates.some((template) => template.id === selectedId.value)) selectedId.value = props.templates[0]!.id
  resetMessage()
  notice.value = ''
  open.value = true
  // El logo PRO se carga con CORS anónimo y su tamaño real: se encaja sin deformarse.
  if (props.branding?.plan === 'pro' && props.branding.logoUrl && !logo.value) {
    const img = await loadFlyerImage(props.branding.logoUrl)
    if (img) logo.value = { image: img, width: img.naturalWidth, height: img.naturalHeight }
  }
  void refreshPreview()
}

async function refreshPreview(): Promise<void> {
  if (!open.value || !selected.value) return
  const token = ++renderToken
  rendering.value = true
  const blob = await renderFlyer(selected.value.input, extras.value)
  if (token !== renderToken) return
  rendering.value = false
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = blob ? URL.createObjectURL(blob) : ''
  if (!blob) notice.value = 'Tu navegador no puede generar la imagen.'
}

async function pickBackground(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const result = await readLocalImage(file)
  if (!result.ok) { notice.value = result.message; return }
  background.value = result.value
  notice.value = ''
}

async function currentBlob(): Promise<Blob | null> {
  return selected.value ? renderFlyer(selected.value.input, extras.value) : null
}

async function sendWhatsApp(): Promise<void> {
  sharing.value = true; notice.value = ''
  try {
    const blob = await currentBlob()
    if (!blob) { notice.value = 'Tu navegador no puede generar la imagen.'; return }
    const outcome = await shareToWhatsApp({ blob, filename: filename.value, title: selected.value?.label ?? 'Quiniela', text: message.value })
    if (outcome === 'downloaded-and-opened') notice.value = 'Descargamos la imagen y abrimos WhatsApp con tu mensaje: adjunta la imagen en el chat.'
    else if (outcome === 'unsupported') notice.value = 'No se pudo compartir en este dispositivo.'
  } finally {
    sharing.value = false
  }
}

async function download(): Promise<void> {
  const blob = await currentBlob()
  if (!blob) { notice.value = 'Tu navegador no puede generar la imagen.'; return }
  const outcome = await shareImage({ blob, filename: filename.value, title: selected.value?.label ?? 'Quiniela' }, {})
  notice.value = outcome === 'downloaded' ? 'Imagen descargada.' : 'No se pudo descargar en este dispositivo.'
}

async function copyMessage(): Promise<void> {
  try {
    await navigator.clipboard.writeText(message.value)
    notice.value = 'Mensaje copiado.'
  } catch {
    notice.value = 'No se pudo copiar el mensaje.'
  }
}

watch(selectedId, () => { resetMessage(); void refreshPreview() })
watch([format, background, logo], () => { void refreshPreview() })
watch(() => props.templates, () => { if (open.value) void refreshPreview() }, { deep: true })
watch(open, (value) => { if (!value) background.value = null })
onBeforeUnmount(() => { if (previewUrl.value) URL.revokeObjectURL(previewUrl.value) })
</script>

<template>
  <SecondaryButton :disabled="!templates.length" data-testid="share-studio-open" @click="openStudio"><Share2 class="h-4 w-4" aria-hidden="true" />{{ buttonLabel }}</SecondaryButton>
  <BottomSheet v-model:open="open" title="Compartir">
    <div class="space-y-4" data-testid="share-studio">
      <div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Qué quieres compartir">
        <button v-for="template in templates" :key="template.id" type="button" role="radio" :aria-checked="selected?.id === template.id"
          class="press-scale min-h-11 shrink-0 rounded-pill border px-4 text-sm font-semibold"
          :class="selected?.id === template.id ? 'border-primary bg-primary-100 text-primary' : 'border-border text-text-muted'"
          @click="selectedId = template.id">{{ template.label }}</button>
      </div>

      <div class="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Formato">
        <button type="button" role="radio" :aria-checked="format === 'chat'" class="press-scale min-h-11 rounded-xl border text-sm font-semibold"
          :class="format === 'chat' ? 'border-primary text-primary' : 'border-border text-text-muted'" @click="format = 'chat'">Chat (4:5)</button>
        <button type="button" role="radio" :aria-checked="format === 'status'" class="press-scale min-h-11 rounded-xl border text-sm font-semibold"
          :class="format === 'status' ? 'border-primary text-primary' : 'border-border text-text-muted'" @click="format = 'status'">Estado (9:16)</button>
      </div>

      <div class="flex justify-center rounded-2xl bg-surface-2 p-2">
        <img v-if="previewUrl" :src="previewUrl" alt="Vista previa de la imagen a compartir" class="max-h-[46dvh] w-auto rounded-xl object-contain" :class="rendering ? 'opacity-60' : ''" />
        <p v-else class="py-16 text-sm text-text-muted">Generando vista previa…</p>
      </div>

      <div class="flex items-center gap-2">
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" class="sr-only" data-testid="share-background-input" @change="pickBackground" />
        <SecondaryButton :full-width="false" class="flex-1" @click="fileInput?.click()"><ImagePlus class="h-4 w-4" aria-hidden="true" />{{ background ? 'Cambiar foto de fondo' : 'Agregar foto de fondo' }}</SecondaryButton>
        <button v-if="background" type="button" class="press-scale icon-button" aria-label="Quitar foto de fondo" @click="background = null"><X class="h-5 w-5" /></button>
      </div>
      <p class="text-xs text-text-muted">La foto se usa solo en tu teléfono para crear la imagen; no se sube a ningún servidor.</p>

      <label class="block text-sm font-medium text-text-muted">Mensaje
        <textarea v-model="message" rows="5" maxlength="1000" class="field-surface mt-1.5 w-full px-3 py-3 text-sm" data-testid="share-message" />
      </label>

      <PrimaryButton :loading="sharing" data-testid="share-whatsapp" @click="sendWhatsApp"><MessageCircle class="h-5 w-5" aria-hidden="true" />Compartir por WhatsApp</PrimaryButton>
      <div class="grid grid-cols-2 gap-2">
        <SecondaryButton @click="download"><Download class="h-4 w-4" aria-hidden="true" />Descargar</SecondaryButton>
        <SecondaryButton @click="copyMessage"><Copy class="h-4 w-4" aria-hidden="true" />Copiar mensaje</SecondaryButton>
      </div>
      <p v-if="notice" class="text-center text-sm text-text-muted" role="status">{{ notice }}</p>
    </div>
  </BottomSheet>
</template>
