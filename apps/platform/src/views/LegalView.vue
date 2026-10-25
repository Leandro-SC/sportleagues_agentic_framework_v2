<script setup lang="ts">
import { computed } from 'vue'
import AppShell from '../components/AppShell.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import { LEGAL_VERSION, PRIVACY, TERMS, legalContactEmail } from '../lib/legal-content'

// Páginas públicas: deben poder leerse antes de registrarse (pantalla de consentimiento de Google y ficha de Play Store).
const props = defineProps<{ doc: 'privacy' | 'terms' }>()
const content = computed(() => (props.doc === 'privacy' ? PRIVACY : TERMS))
const contact = legalContactEmail()
</script>

<template>
  <AppShell variant="screen" :title="content.title">
    <ScreenHeader :title="content.title" :back="true" />
    <article class="space-y-5 pb-10 text-sm leading-relaxed text-text-muted" data-testid="legal-doc">
      <p class="text-xs text-text-faint">Versión {{ LEGAL_VERSION }}</p>
      <p class="text-text">{{ content.intro }}</p>
      <section v-for="section in content.sections" :key="section.title" class="space-y-2">
        <h2 class="font-display text-base font-bold text-text">{{ section.title }}</h2>
        <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
      </section>
      <section class="space-y-2" data-testid="legal-contact">
        <h2 class="font-display text-base font-bold text-text">Contacto</h2>
        <p v-if="contact">Escríbenos a <a :href="`mailto:${contact}`" class="font-semibold text-primary underline">{{ contact }}</a>.</p>
        <p v-else>Para consultas de privacidad, contacta al organizador de tu quiniela o usa la opción de eliminar tu cuenta desde Perfil.</p>
      </section>
      <p class="pt-2">
        <RouterLink v-if="doc === 'privacy'" :to="{ name: 'terms' }" class="font-semibold text-primary underline">Ver Términos de uso</RouterLink>
        <RouterLink v-else :to="{ name: 'privacy' }" class="font-semibold text-primary underline">Ver Política de privacidad</RouterLink>
      </p>
    </article>
  </AppShell>
</template>
