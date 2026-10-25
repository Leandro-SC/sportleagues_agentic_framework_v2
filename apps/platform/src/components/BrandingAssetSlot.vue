<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ImageIcon, LoaderCircle, Sparkles, Trash2, Upload } from 'lucide-vue-next'
import { brandingAssetLimits, brandingControlsAvailable, validateBrandingFile, type BrandingAssetKind } from '../lib/admin-contracts'
import { fixLogo, type LogoFixResult } from '../lib/logo-fix'
import type { BrandingAssetPreview } from '../composables/useAdmin'
import PrimaryButton from './PrimaryButton.vue'
import SecondaryButton from './SecondaryButton.vue'

const props = defineProps<{
  kind: BrandingAssetKind
  plan: 'free' | 'pro'
  asset: BrandingAssetPreview | null
  busy?: boolean
  error?: string
  /** Ajuste inteligente del logo (inyectable en pruebas). */
  fixer?: (file: File) => Promise<LogoFixResult>
}>()

const emit = defineEmits<{ upload: [file: File]; remove: [] }>()
const input = ref<HTMLInputElement | null>(null)
const localPreview = ref('')
const localError = ref('')
const confirmingRemoval = ref(false)
const pending = ref(false)
const analyzing = ref(false)
// Propuesta del ajuste inteligente: el organizador compara y elige; nada se sube hasta que decide.
type Proposal = { original: File; originalUrl: string; originalError: string | null; fixed: File; fixedUrl: string; notes: string[] }
const proposal = ref<Proposal | null>(null)
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

function startUpload(file: File): void {
  revokeLocalPreview()
  localPreview.value = URL.createObjectURL(file)
  pending.value = true
  emit('upload', file)
}

function discardProposal(): void {
  if (proposal.value) { URL.revokeObjectURL(proposal.value.originalUrl); URL.revokeObjectURL(proposal.value.fixedUrl) }
  proposal.value = null
}

function chooseProposal(which: 'fixed' | 'original'): void {
  const current = proposal.value
  if (!current || (which === 'original' && current.originalError)) return
  const file = which === 'fixed' ? current.fixed : current.original
  discardProposal()
  startUpload(file)
}

async function selectFile(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  localError.value = ''
  discardProposal()
  const dimensions = await imageDimensions(file)
  const validationError = dimensions ? validateBrandingFile(props.kind, file, dimensions) : validateBrandingFile(props.kind, file) ?? 'No pudimos leer las dimensiones de la imagen.'
  if (isLogo.value) {
    analyzing.value = true
    const fixed = await (props.fixer ?? fixLogo)(file).catch((): LogoFixResult => ({ ok: false, message: '' }))
    analyzing.value = false
    if (fixed.ok) {
      proposal.value = { original: file, originalUrl: URL.createObjectURL(file), originalError: validationError, fixed: fixed.file, fixedUrl: URL.createObjectURL(fixed.file), notes: fixed.notes }
      return
    }
  }
  if (validationError) { localError.value = validationError; return }
  startUpload(file)
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
onBeforeUnmount(() => { revokeLocalPreview(); discardProposal() })
</script>

<template>
  <section class="min-w-0" :aria-labelledby="`branding-${kind}`">
    <div class="mb-2 flex items-baseline justify-between gap-3">
      <div>
        <h3 :id="`branding-${kind}`" class="text-sm font-semibold text-text">{{ heading }}</h3>
        <p class="mt-0.5 text-xs text-text-muted">{{ dimensionsCopy }}</p>
      </div>
      <span v-if="pending && !busy" class="text-xs font-medium text-warn">Listo para subir</span>
    </div>

    <div
      class="relative overflow-hidden rounded-xl border border-border bg-surface-2"
      :class="isLogo ? 'aspect-square max-w-44' : 'aspect-[8/3] w-full'"
    >
      <img v-if="previewUrl" :src="previewUrl" :alt="`${heading} actual`" class="h-full w-full" :class="isLogo ? 'object-contain p-5' : 'object-cover'" />
      <div v-else class="flex h-full flex-col items-center justify-center px-4 text-center text-text-muted">
        <ImageIcon class="mb-2 h-5 w-5 text-text-faint" aria-hidden="true" />
        <p class="text-sm font-medium text-text">{{ isLogo ? 'Sin logo personalizado' : 'Sin banner personalizado' }}</p>
        <p class="mt-1 text-xs">{{ emptyCopy }}</p>
      </div>
      <div v-if="busy" class="absolute inset-0 flex items-center justify-center gap-2 bg-canvas/80 text-sm font-medium text-text" role="status">
        <LoaderCircle class="h-4 w-4 animate-spin text-primary" />Subiendo {{ heading.toLowerCase() }}…
      </div>
    </div>

    <p v-if="plan === 'free'" class="mt-3 text-sm text-text-muted">Logo y banner personalizados están disponibles en PRO.</p>
    <template v-else>
      <input ref="input" class="sr-only" type="file" accept="image/png,image/jpeg,image/webp" :aria-label="`Seleccionar ${heading.toLowerCase()}`" :disabled="busy" @change="selectFile" />
      <div class="mt-3 flex flex-wrap gap-2">
        <PrimaryButton :full-width="false" :disabled="busy" @click="openPicker"><Upload class="h-4 w-4" />{{ asset ? 'Reemplazar' : `Subir ${heading.toLowerCase()}` }}</PrimaryButton>
        <SecondaryButton v-if="asset" :full-width="false" tone="danger" :disabled="busy" @click="requestRemoval"><Trash2 class="h-4 w-4" />Eliminar</SecondaryButton>
      </div>
      <p v-if="analyzing" class="mt-3 flex items-center gap-2 text-sm text-text-muted" role="status"><LoaderCircle class="h-4 w-4 animate-spin text-primary" />Ajustando tu logo…</p>
      <div v-if="proposal" class="mt-3 space-y-3 rounded-xl border border-primary/40 bg-surface-2 p-3" data-testid="logo-fix-proposal">
        <p class="flex items-center gap-2 text-sm font-semibold text-text"><Sparkles class="h-4 w-4 text-primary" aria-hidden="true" />Ajuste automático de tu logo</p>
        <div class="grid grid-cols-2 gap-3 text-center text-xs text-text-muted">
          <figure><div class="aspect-square overflow-hidden rounded-lg border border-border bg-[repeating-conic-gradient(#0a2434_0_25%,#071b29_0_50%)] bg-size-[16px_16px]"><img :src="proposal.originalUrl" alt="Logo original" class="h-full w-full object-contain" /></div><figcaption class="mt-1">Original</figcaption></figure>
          <figure><div class="aspect-square overflow-hidden rounded-lg border border-primary/60 bg-[repeating-conic-gradient(#0a2434_0_25%,#071b29_0_50%)] bg-size-[16px_16px]"><img :src="proposal.fixedUrl" alt="Logo ajustado" class="h-full w-full object-contain" /></div><figcaption class="mt-1 font-semibold text-primary">Ajustado</figcaption></figure>
        </div>
        <ul v-if="proposal.notes.length" class="list-disc space-y-0.5 pl-5 text-xs text-text-muted"><li v-for="note in proposal.notes" :key="note">{{ note }}</li></ul>
        <div class="grid gap-2">
          <PrimaryButton data-testid="logo-fix-use-fixed" @click="chooseProposal('fixed')">Usar versión ajustada</PrimaryButton>
          <SecondaryButton :disabled="Boolean(proposal.originalError)" data-testid="logo-fix-use-original" @click="chooseProposal('original')">Usar original</SecondaryButton>
          <p v-if="proposal.originalError" class="text-xs text-text-muted">El original no se puede subir tal cual: {{ proposal.originalError }}</p>
          <button type="button" class="min-h-11 text-sm text-text-muted" @click="discardProposal">Cancelar</button>
        </div>
      </div>
      <div v-if="confirmingRemoval" class="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3 text-sm">
        <p class="font-medium text-text">¿Eliminar el {{ heading.toLowerCase() }}?</p>
        <div class="flex shrink-0 gap-2"><button type="button" class="rounded-lg px-2.5 py-1.5 text-text-muted hover:bg-surface-3" @click="confirmingRemoval = false">Cancelar</button><button type="button" class="rounded-lg bg-danger-100 px-2.5 py-1.5 font-semibold text-danger hover:bg-danger-100/70" @click="confirmRemoval">Eliminar</button></div>
      </div>
    </template>
    <p v-if="localError || error" class="mt-2 text-sm font-medium text-danger" role="alert">{{ localError || error }}</p>
  </section>
</template>
