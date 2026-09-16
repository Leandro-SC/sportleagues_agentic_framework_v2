<script setup lang="ts">
withDefaults(
  defineProps<{
    id: string
    label: string
    modelValue: string
    type?: string
    placeholder?: string
    maxlength?: number
    autocomplete?: string
    required?: boolean
    hint?: string
    error?: string
    inputClass?: string
    disabled?: boolean
  }>(),
  { type: 'text', required: false, disabled: false },
)

defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="space-y-1.5">
    <label :for="id" class="block text-sm font-medium text-ink-700">{{ label }}</label>
    <input
      :id="id"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :required="required"
      :disabled="disabled"
      class="w-full rounded-xl border border-mist-300 bg-white px-4 py-3 text-[15px] text-ink-900 placeholder:text-mist-400 focus:border-brand-500"
      :class="[error ? 'border-danger-500' : '', inputClass]"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="error" class="text-sm font-medium text-danger-600" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="text-sm text-ink-500">{{ hint }}</p>
  </div>
</template>
