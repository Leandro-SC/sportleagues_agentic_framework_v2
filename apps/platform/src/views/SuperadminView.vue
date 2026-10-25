<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Check, ShieldCheck } from 'lucide-vue-next'
import SuperadminShell from '../components/SuperadminShell.vue'
import { useAuth } from '../composables/useAuth'
import { getSupabaseClient } from '../lib/supabase'

const router = useRouter()
const auth = useAuth()
type EditableOffer = { offer_code: string; plan_code: string; scope: string; price_minor: number; currency: string; billing_period: 'month' | 'year' | 'one_time'; benefits: string[]; is_public: boolean }
const offers = ref<EditableOffer[]>([])
const savingOffer = ref('')
const offerMessage = ref('')

onMounted(async () => {
  const { data } = await getSupabaseClient().from('plan_offers').select('offer_code, plan_code, scope, price_minor, currency, billing_period, benefits, is_public').order('price_minor')
  offers.value = (data ?? []) as EditableOffer[]
})

async function saveOffer(offer: EditableOffer): Promise<void> {
  savingOffer.value = offer.offer_code; offerMessage.value = ''
  const benefits = offer.benefits.filter((benefit) => benefit.trim())
  const { error } = await getSupabaseClient().rpc('update_plan_offer', { p_offer_code: offer.offer_code, p_price_minor: offer.price_minor, p_currency: offer.currency, p_billing_period: offer.billing_period, p_benefits: benefits, p_is_public: offer.is_public })
  savingOffer.value = ''
  offerMessage.value = error ? 'No se pudo guardar la oferta.' : 'Oferta actualizada.'
}

async function handleLogout(): Promise<void> {
  await auth.signOut()
  await router.replace({ name: 'home' })
}
</script>

<template>
  <SuperadminShell :user-name="auth.state.user?.email" @logout="handleLogout">
    <section class="space-y-6">
      <div>
        <h1 class="font-display text-xl font-bold text-text">Administración de plataforma</h1>
        <p class="mt-1 text-sm text-text-muted">SportLeagues</p>
      </div>

      <div class="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
        <span class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary">
          <ShieldCheck class="h-5 w-5" />
        </span>
        <div>
          <p class="text-sm font-semibold text-text">Sesión verificada como Superadmin.</p>
          <p class="mt-1 text-sm text-text-muted">Este entorno es independiente del panel de organizador. Los módulos de tenants, planes y auditoría se habilitarán en fases posteriores.</p>
        </div>
      </div>
      <section class="space-y-3" aria-label="Ofertas de planes">
        <div><h2 class="font-display text-lg font-bold text-text">Planes y precios</h2><p class="text-sm text-text-muted">Modificar una oferta no cobra ni cambia automáticamente los planes de clientes.</p></div>
        <article v-for="offer in offers" :key="offer.offer_code" class="app-surface space-y-3 p-4">
          <div class="flex justify-between gap-2"><strong class="text-text">{{ offer.offer_code }}</strong><span class="text-xs text-text-muted">{{ offer.scope === 'single_pool' ? 'Una quiniela' : 'Organización' }}</span></div>
          <label class="block text-sm text-text-muted">Precio en céntimos<input v-model.number="offer.price_minor" type="number" min="0" class="field-surface mt-1 w-full px-3 py-2 text-text" /></label>
          <div class="grid grid-cols-2 gap-2"><label class="text-sm text-text-muted">Moneda<input v-model="offer.currency" maxlength="3" class="field-surface mt-1 w-full px-3 py-2 uppercase text-text" /></label><label class="text-sm text-text-muted">Periodo<select v-model="offer.billing_period" class="field-surface mt-1 w-full px-3 py-2 text-text"><option value="month">Mes</option><option value="year">Año</option><option value="one_time">Único</option></select></label></div>
          <label class="flex gap-2 text-sm text-text"><input v-model="offer.is_public" type="checkbox" class="accent-primary" />Mostrar esta oferta públicamente</label>
          <button type="button" class="press-scale flex min-h-11 items-center gap-2 rounded-pill bg-primary px-4 text-sm font-bold text-canvas disabled:opacity-50" :disabled="savingOffer === offer.offer_code" @click="saveOffer(offer)"><Check class="h-4 w-4" />{{ savingOffer === offer.offer_code ? 'Guardando…' : 'Guardar oferta' }}</button>
        </article>
        <p v-if="offerMessage" class="text-sm font-medium text-primary" role="status">{{ offerMessage }}</p>
      </section>
    </section>
  </SuperadminShell>
</template>
