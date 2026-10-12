<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Ticket } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import EmptyState from '../components/EmptyState.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import { useAuth } from '../composables/useAuth'

// Los tickets (ADR-014) aún no tienen backend: ADR en estado Proposed. Esta pantalla no muestra datos de ejemplo; solo informa y
// lleva a lo que sí existe hoy (participar y pronosticar por quiniela).
const auth = useAuth()
const router = useRouter()
</script>

<template>
  <AppShell variant="app" active="points" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Mis tickets" :back="{ name: 'home' }" />
    <section class="space-y-4">
      <EmptyState :icon="Ticket" title="Los tickets aún no están disponibles" description="Hoy participas directamente en cada quiniela con un pronóstico por partido. Cuando se habiliten los tickets, tus jugadas aparecerán aquí.">
        <template #action><SecondaryButton @click="router.push({ name: 'leagues' })">Ir a mis ligas</SecondaryButton></template>
      </EmptyState>
    </section>
  </AppShell>
</template>
