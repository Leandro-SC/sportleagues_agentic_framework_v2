<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'

// Campo del formulario de acceso: icono a la izquierda y, en contraseñas, botón para mostrar/ocultar.
const props = withDefaults(
  defineProps<{
    id: string
    modelValue: string
    placeholder: string
    icon: Component
    type?: string
    autocomplete?: string
    maxlength?: number
    required?: boolean
    hint?: string
    error?: string
  }>(),
  { type: 'text', required: false },
)
defineEmits<{ 'update:modelValue': [value: string] }>()

const revealed = ref(false)
const isPassword = computed(() => props.type === 'password')
const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type))
</script>

<template>
  <div class="space-y-1.5">
    <label :for="id" class="sr-only">{{ placeholder }}</label>
    <div
      class="flex items-center gap-3 rounded-pill border bg-canvas/40 px-4 transition-colors focus-within:border-primary"
      :class="error ? 'border-danger' : 'border-secondary/25'"
    >
      <component :is="icon" class="h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />
      <input
        :id="id"
        :type="inputType"
        :value="modelValue"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :maxlength="maxlength"
        :required="required"
        class="min-h-12 w-full min-w-0 [@media(max-height:700px)]:min-h-11 bg-transparent text-[15px] text-text outline-none placeholder:text-text-muted"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="isPassword"
        type="button"
        class="icon-button -mr-3 text-secondary"
        :aria-label="revealed ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        :aria-pressed="revealed"
        @click="revealed = !revealed"
      >
        <EyeOff v-if="revealed" class="h-5 w-5" />
        <Eye v-else class="h-5 w-5" />
      </button>
    </div>
    <p v-if="error" class="px-4 text-sm font-medium text-danger" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="px-4 text-sm text-text-muted">{{ hint }}</p>
  </div>
</template>
