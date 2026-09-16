<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ImageIcon, LoaderCircle, Trash2, Upload } from 'lucide-vue-next'
import { brandingAssetLimits, brandingControlsAvailable, validateBrandingFile, type BrandingAssetKind } from '../lib/admin-contracts'
import type { BrandingAssetPreview } from '../composables/useAdmin'
import PrimaryButton from './PrimaryButton.vue'
import SecondaryButton from './SecondaryButton.vue'

const props = defineProps<{
  kind: BrandingAssetKind
  plan: 'free' | 'pro'
  asset: BrandingAssetPreview | null
  busy?: boolean
  error?: string
}>()

const emit = defineEmits<{ upload: [file: File]; remove: [] }>()
const input = ref<HTMLInputElement | null>(null)
const localPreview = ref('')
const localError = ref('')
const confirmingRemoval = ref(false)
const pending = ref(false)
const isLogo = computed(() => props.kind === 'logo')
const limits = computed(() => brandingAssetLimits[props.kind])
const controlsAvailable = computed(() => brandingControlsAvailable(props.plan))
const previewUrl = computed(() => localPreview.value || props.asset?.signed_url || '')
const heading = computed(() => isLogo.value ? 'Logo' : 'Banner')
const emptyCopy = computed(() => isLogo.value ? 'PNG, JPEG o WebP · hasta 1 MiB' : 'PNG, JPEG o WebP · hasta 2 MiB')
const dimensionsCopy = computed(() => isLogo.value ? 'Recomendado 512 × 512' : 'Recomendado 1600 × 600')

function revokeLocalPreview(): void {
  if (localPreview.value) URL.revokeObjectURL(localPreview.value)
  localPreview.value = ''
  pending.value = false
}

function openPicker(): void {
  if (!controlsAvailable.value || props.busy) return
  input.value?.click()
}

async function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => resolve(null)
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function selectFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  localError.value = ''
  const dimensions = await imageDimensions(file)
  const validationError = validateBrandingFile(props.kind, file, dimensions ?? undefined)
  if (validationError || !dimensions) {
    localError.value = validationError ?? 'No pudimos leer las dimensiones de la imagen.'
    ;(event.target as HTMLInputElement).value = ''
    return
  }
  revokeLocalPreview()
  localPreview.value = URL.createObjectURL(file)
  pending.value = true
  emit('upload', file)
  ;(event.target as HTMLInputElement).value = ''
}

function requestRemoval(): void {
  confirmingRemoval.value = true
}

function confirmRemoval(): void {
  confirmingRemoval.value = false
  emit('remove')
}

watch(() => props.asset?.asset_id, () => {
  if (props.asset) revokeLocalPreview()
})
watch(() => props.error, (error) => {
  if (error) revokeLocalPreview()
})
onBeforeUnmount(revokeLocalPreview)
</script>

<template>
  <section class="min-w-0" :aria-labelledby="`branding-${kind}`">
    <div class="mb-2 flex items-baseline justify-between gap-3">
      <div>
        <h3 :id="`branding-${kind}`" class="text-sm font-semibold text-ink-900">{{ heading }}</h3>
        <p class="mt-0.5 text-xs text-ink-500">{{ dimensionsCopy }}</p>
      </div>
      <span v-if="pending && !busy" class="text-xs font-medium text-warn-600">Listo para subir</span>
    </div>

    <div
      class="relative overflow-hidden rounded-xl border border-mist-200 bg-mist-50"
      :class="isLogo ? 'aspect-square max-w-44' : 'aspect-[8/3] w-full'"
    >
      <img v-if="previewUrl" :src="previewUrl" :alt="`${heading} actual`" class="h-full w-full" :class="isLogo ? 'object-contain p-5' : 'object-cover'" />
      <div v-else class="flex h-full flex-col items-center justify-center px-4 text-center text-ink-500">
        <ImageIcon class="mb-2 h-5 w-5 text-mist-400" aria-hidden="true" />
        <p class="text-sm font-medium text-ink-700">{{ isLogo ? 'Sin logo personalizado' : 'Sin banner personalizado' }}</p>
        <p class="mt-1 text-xs">{{ emptyCopy }}</p>
      </div>
      <div v-if="busy" class="absolute inset-0 flex items-center justify-center gap-2 bg-white/80 text-sm font-medium text-ink-700" role="status">
        <LoaderCircle class="h-4 w-4 animate-spin text-brand-600" />Subiendo {{ heading.toLowerCase() }}…
      </div>
    </div>

    <p v-if="plan === 'free'" class="mt-3 text-sm text-ink-600">Logo y banner personalizados están disponibles en PRO.</p>
    <template v-else>
      <input ref="input" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" :aria-label="`Seleccionar ${heading.toLowerCase()}`" :disabled="busy" @change="selectFile" />
      <div class="mt-3 flex flex-wrap gap-2">
        <PrimaryButton :full-width="false" :disabled="busy" @click="openPicker"><Upload class="h-4 w-4" />{{ asset ? 'Reemplazar' : `Subir ${heading.toLowerCase()}` }}</PrimaryButton>
        <SecondaryButton v-if="asset" :full-width="false" tone="danger" :disabled="busy" @click="requestRemoval"><Trash2 class="h-4 w-4" />Eliminar</SecondaryButton>
      </div>
      <div v-if="confirmingRemoval" class="mt-3 flex items-center justify-between gap-3 rounded-xl border border-mist-200 bg-white p-3 text-sm">
        <p class="font-medium text-ink-800">¿Eliminar el {{ heading.toLowerCase() }}?</p>
        <div class="flex shrink-0 gap-2"><button type="button" class="rounded-lg px-2.5 py-1.5 text-ink-600 hover:bg-mist-100" @click="confirmingRemoval = false">Cancelar</button><button type="button" class="rounded-lg bg-danger-100 px-2.5 py-1.5 font-semibold text-danger-600 hover:bg-danger-100/70" @click="confirmRemoval">Eliminar</button></div>
      </div>
    </template>
    <p v-if="localError || error" class="mt-2 text-sm font-medium text-danger-600" role="alert">{{ localError || error }}</p>
  </section>
</template>
