<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronRight, KeyRound, SearchX } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import CatalogBoundary from '../components/CatalogBoundary.vue'
import CommunityLeagueRow from '../components/CommunityLeagueRow.vue'
import EmptyState from '../components/EmptyState.vue'
import PreviewBadge from '../components/PreviewBadge.vue'
import ScreenHeader from '../components/ScreenHeader.vue'
import SearchField from '../components/SearchField.vue'
import TeamCrest from '../components/TeamCrest.vue'
import { useAuth } from '../composables/useAuth'
import { useSportsCatalog } from '../composables/useSportsCatalog'
import { classifyLeagueQuery, matchesText, SPORT_LABELS, type CommunityLeague } from '../lib/sports-catalog'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const sports = useSportsCatalog()

const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const showAll = ref(false)
const previewNotice = ref('')

const parsed = computed(() => classifyLeagueQuery(query.value))
const leagues = computed(() => sports.catalog.value.communityLeagues)

// Con un código válido se muestra la tarjeta para unirse por el flujo real (join_pool). Si el
// código coincide con una liga de vista previa se muestran sus datos de ejemplo, marcados como tal.
const featured = computed<CommunityLeague | null>(() => {
  if (parsed.value.kind === 'code') {
    const code = parsed.value.code
    return leagues.value.find((league) => league.code === code) ?? null
  }
  return parsed.value.kind === 'empty' ? leagues.value[0] ?? null : null
})

const recommended = computed(() => {
  const list = leagues.value.filter((league) => league.id !== featured.value?.id)
  // Un texto de 6 caracteres puede ser un código o parte de un nombre: se usa para ambas cosas.
  const filtered = parsed.value.kind !== 'empty' ? list.filter((league) => matchesText(league.name, query.value) || matchesText(league.code, query.value)) : list
  return showAll.value ? filtered : filtered.slice(0, 4)
})

const totalRecommended = computed(() => leagues.value.filter((league) => league.id !== featured.value?.id).length)

function joinWithCode(code: string): void {
  void router.push({ name: 'join', params: { code } })
}

function joinPreview(league: CommunityLeague): void {
  if (parsed.value.kind === 'code' && parsed.value.code === league.code) {
    joinWithCode(league.code)
    return
  }
  previewNotice.value = `“${league.name}” es una liga de ejemplo. Para unirte a una liga real, escribe el código que te compartió tu organizador.`
}

function submit(): void {
  if (parsed.value.kind === 'code') joinWithCode(parsed.value.code)
}
</script>

<template>
  <AppShell variant="app" active="leagues" :user-name="auth.state.profile?.display_name">
    <ScreenHeader title="Unirme a una liga" :back="{ name: 'leagues' }" />

    <div class="space-y-6 pb-4">
      <div class="space-y-2">
        <SearchField id="league-search" v-model="query" label="Buscar liga por código o nombre" placeholder="Buscar liga por código o nombre..." @submit="submit" />
        <p class="px-1 text-xs text-text-muted">El código tiene 6 letras o números, por ejemplo <span class="font-semibold text-text">7F3A2B</span>.</p>
      </div>

      <article v-if="parsed.kind === 'code' && !featured" class="app-surface space-y-4 bg-linear-to-b from-surface-2 to-surface p-5">
        <div class="flex items-center gap-4">
          <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-primary/70 bg-primary-100 text-primary">
            <KeyRound class="h-7 w-7" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-text">Código de invitación</p>
            <span class="mt-1 inline-block rounded-md bg-primary-100 px-2 py-0.5 text-xs font-bold tracking-widest text-primary">#{{ parsed.code }}</span>
            <p class="mt-1.5 text-xs text-text-muted">Verificaremos el código y verás la liga al unirte.</p>
          </div>
        </div>
        <button type="button" class="press-scale w-full rounded-xl bg-primary py-3 text-sm font-bold text-canvas shadow-glow-primary" @click="joinWithCode(parsed.code)">Unirme</button>
      </article>

      <article v-else-if="featured" class="app-surface space-y-4 bg-linear-to-b from-surface-2 to-surface p-5">
        <div class="flex items-center gap-4">
          <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-text/70 bg-canvas">
            <TeamCrest :name="featured.name" :colors="featured.colors" size="md" />
          </span>
          <div class="min-w-0">
            <p class="truncate text-sm font-semibold text-text">{{ featured.name }}</p>
            <span class="mt-1 inline-block rounded-md bg-primary-100 px-2 py-0.5 text-xs font-bold tracking-widest text-primary">#{{ featured.code }}</span>
            <p class="mt-1.5 text-xs text-text-muted">
              {{ featured.members_count }}{{ featured.capacity ? `/${featured.capacity}` : '' }} miembros
            </p>
            <p class="text-xs text-text-muted">{{ SPORT_LABELS[featured.sport] }} · {{ featured.format_label }}</p>
            <PreviewBadge class="mt-2" />
          </div>
        </div>
        <button type="button" class="press-scale w-full rounded-xl bg-primary py-3 text-sm font-bold text-canvas shadow-glow-primary" @click="joinPreview(featured)">Unirme</button>
      </article>

      <article v-else-if="!sports.preview" class="app-surface flex items-start gap-3 p-4 text-sm text-text-muted">
        <KeyRound class="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        Escribe el código de invitación de 6 caracteres que te compartió tu organizador.
      </article>

      <p v-if="previewNotice" class="rounded-xl border border-warn/30 bg-warn-100 p-3 text-sm text-warn" role="status">{{ previewNotice }}</p>

      <CatalogBoundary v-if="sports.loading.value || sports.failed.value" :loading="sports.loading.value" :failed="sports.failed.value" :rows="3" row-height="5rem" @retry="sports.retry" />

      <section v-else-if="sports.preview && (recommended.length || parsed.kind !== 'code')">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="font-display text-base font-bold text-text">Ligas recomendadas</h2>
          <button
            v-if="totalRecommended > 4"
            type="button"
            class="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline"
            :aria-expanded="showAll"
            @click="showAll = !showAll"
          >{{ showAll ? 'Ver menos' : 'Ver todas' }}<ChevronRight class="h-3.5 w-3.5" :class="showAll ? '-rotate-90' : ''" /></button>
        </div>
        <ul v-if="recommended.length" class="space-y-2.5">
          <CommunityLeagueRow v-for="league in recommended" :key="league.id" :league="league" @join="joinPreview" />
        </ul>
        <EmptyState v-else :icon="SearchX" title="Sin ligas con ese nombre" description="Revisa el nombre o usa el código de invitación." />
      </section>
    </div>
  </AppShell>
</template>
