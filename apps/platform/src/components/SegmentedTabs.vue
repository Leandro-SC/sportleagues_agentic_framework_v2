<script setup lang="ts" generic="T extends string">
// Tres variantes de la referencia: `pill` (Hoy/Mañana/Esta semana), `chip` (Resumen/Equipos/…)
// y `underline` (Partidos/Plantilla/Estadísticas). Navegable con flechas según el patrón tablist.
const props = withDefaults(defineProps<{ options: Array<{ value: T; label: string }>; label: string; variant?: 'pill' | 'chip' | 'underline' }>(), { variant: 'pill' })
const model = defineModel<T>({ required: true })

function move(event: KeyboardEvent, index: number): void {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const next = (index + step + props.options.length) % props.options.length
  model.value = props.options[next]!.value
  const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  buttons?.[next]?.focus()
}
</script>

<template>
  <div
    role="tablist"
    :aria-label="label"
    class="flex"
    :class="{
      'gap-2': variant === 'pill',
      'items-center justify-between gap-1': variant === 'chip',
      'border-b border-border': variant === 'underline',
    }"
  >
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      class="press-scale font-semibold transition-colors"
      :class="{
        'flex-1 whitespace-nowrap rounded-pill border px-2 py-2 text-[13px]': variant === 'pill',
        'border-primary bg-primary text-canvas shadow-glow-primary': variant === 'pill' && model === option.value,
        'border-border-strong bg-surface-2/70 text-text-muted hover:text-text': variant === 'pill' && model !== option.value,
        'min-w-0 flex-1 rounded-lg px-1.5 py-2 text-[13px] min-[360px]:text-sm': variant === 'chip',
        'bg-primary text-canvas': variant === 'chip' && model === option.value,
        'text-text-muted hover:text-text': variant !== 'pill' && model !== option.value,
        'relative flex-1 pb-3 pt-1 text-sm': variant === 'underline',
        'text-primary after:absolute after:inset-x-3 after:-bottom-px after:h-[3px] after:rounded-pill after:bg-primary': variant === 'underline' && model === option.value,
      }"
      @click="model = option.value"
      @keydown="move($event, index)"
    >{{ option.label }}</button>
  </div>
</template>
