<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { CalendarDays, ChartColumn, ChevronRight, KeyRound, ListOrdered, Trophy, UsersRound } from 'lucide-vue-next'
import { useAuth } from '../composables/useAuth'
import { useFollowedTeams } from '../composables/useFollowedTeams'
import { useMyPools } from '../composables/useMyPools'
import { useSportsCatalog } from '../composables/useSportsCatalog'
import { firstNameOf, initialsOf, searchCatalog, upcomingMatches, type CatalogSearchResult } from '../lib/sports-catalog'
import EmptyState from './EmptyState.vue'
import ErrorState from './ErrorState.vue'
import FollowedTeamCard from './FollowedTeamCard.vue'
import LiveMatchCarousel from './LiveMatchCarousel.vue'
import LoadingSkeleton from './LoadingSkeleton.vue'
import NotificationsButton from './NotificationsButton.vue'
import PoolCard from './PoolCard.vue'
import PreviewBadge from './PreviewBadge.vue'
import PrimaryButton from './PrimaryButton.vue'
import QuickActionTile from './QuickActionTile.vue'
import SearchField from './SearchField.vue'
import SectionHeader from './SectionHeader.vue'
import UpcomingMatchCard from './UpcomingMatchCard.vue'

const router = useRouter()
const auth = useAuth()
const sports = useSportsCatalog()
const myPools = useMyPools()
const followed = useFollowedTeams(() => sports.catalog.value.followedTeamIds)

const query = ref('')
const searchOpen = ref(false)
const searchRoot = ref<HTMLElement | null>(null)

const firstName = computed(() => firstNameOf(auth.state.profile?.display_name))
const initials = computed(() => initialsOf(auth.state.profile?.display_name))
const liveMatches = computed(() => sports.catalog.value.matches.filter((match) => match.status === 'live'))
const upcoming = computed(() => upcomingMatches(sports.catalog.value.matches, sports.now.value, 2))
const followedTeams = computed(() => followed.ids.value.map((id) => sports.team(id)).filter((team) => team !== undefined))
const featuredCompetition = computed(() => sports.catalog.value.competitions[0])
const results = computed(() => searchCatalog(query.value, sports.catalog.value, myPools.pools.value))

watch(() => auth.state.user?.id, (profileId) => { void myPools.load(profileId) })
// Cierra los resultados al tocar fuera. Se usa pointerdown en el documento (no focusout) porque en
// Safari iOS los botones no reciben foco al tocarlos y el clic se perdería.
function closeOnOutsidePointer(event: PointerEvent): void {
  if (searchRoot.value && !searchRoot.value.contains(event.target as Node)) searchOpen.value = false
}

onMounted(() => {
  void myPools.load(auth.state.user?.id)
  document.addEventListener('pointerdown', closeOnOutsidePointer)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsidePointer))
watch(query, (value) => { searchOpen.value = value.trim().length >= 2 })

function openResult(result: CatalogSearchResult): void {
  searchOpen.value = false
  if (result.kind === 'pool') void router.push({ name: 'pool', params: { poolId: result.id } })
  else if (result.kind === 'competition') void router.push({ name: 'league', params: { leagueId: result.id } })
  else void router.push({ name: 'team', params: { teamId: result.id } })
}

function submitSearch(): void {
  if (results.value[0]) openResult(results.value[0])
  else void router.push({ name: 'league-join', query: { q: query.value.trim() } })
}

const resultIcon = { pool: Trophy, competition: ListOrdered, team: UsersRound }
</script>

<template>
  <section class="space-y-6 pb-4">
    <header class="safe-top flex items-start justify-between gap-3 pt-4">
      <div class="min-w-0">
        <h1 class="truncate font-display text-[26px] font-bold leading-tight text-text">Hola, {{ firstName || 'de nuevo' }} 👋</h1>
        <p class="text-sm text-text-muted">El deporte nos une</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <NotificationsButton />
        <RouterLink
          :to="{ name: 'profile' }"
          class="press-scale flex h-11 w-11 items-center justify-center rounded-full bg-surface-3 font-display text-sm font-bold text-text ring-1 ring-white/15"
          aria-label="Ver perfil"
        >{{ initials }}</RouterLink>
      </div>
    </header>

    <div ref="searchRoot" class="relative -mt-2" @keydown.esc="searchOpen = false" @focusin="searchOpen = query.trim().length >= 2">
      <SearchField id="home-search" v-model="query" label="Buscar liga, equipo o jugador" placeholder="Buscar liga, equipo o jugador..." @submit="submitSearch" />
      <div v-if="searchOpen" class="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-lg">
        <ul v-if="results.length" aria-label="Resultados de búsqueda">
          <li v-for="result in results" :key="`${result.kind}-${result.id}`">
            <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2" @click="openResult(result)">
              <component :is="resultIcon[result.kind]" class="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold text-text">{{ result.title }}</span>
                <span class="block truncate text-xs text-text-muted">{{ result.subtitle }}</span>
              </span>
              <ChevronRight class="h-4 w-4 text-text-faint" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <button v-else type="button" class="w-full px-4 py-3 text-left text-sm text-text-muted hover:bg-surface-2" @click="submitSearch">
          Sin coincidencias. Buscar “{{ query.trim() }}” entre las ligas para unirte →
        </button>
      </div>
    </div>

    <div v-if="!auth.state.profile" class="rounded-2xl border border-primary/40 bg-primary-100/50 p-5">
      <h2 class="font-display text-lg font-bold text-text">Un último paso</h2>
      <p class="mt-1 text-sm text-text-muted">Completa tu perfil para acceder a tus ligas.</p>
      <PrimaryButton class="mt-4" @click="router.push({ name: 'onboarding' })">Completar perfil</PrimaryButton>
    </div>

    <template v-if="sports.preview && liveMatches.length">
      <div class="-mt-2 space-y-2">
        <PreviewBadge />
        <LiveMatchCarousel :matches="liveMatches" :competition="sports.competition" :team="sports.team" />
      </div>
    </template>

    <nav aria-label="Accesos rápidos" class="grid grid-cols-4 gap-2.5">
      <QuickActionTile :icon="UsersRound" label="Mis ligas" :to="{ name: 'leagues' }" />
      <QuickActionTile :icon="CalendarDays" label="Calendario" :to="{ name: 'matches' }" />
      <QuickActionTile :icon="ListOrdered" label="Tabla" :to="featuredCompetition ? { name: 'league', params: { leagueId: featuredCompetition.id }, query: { tab: 'tabla' } } : { name: 'leagues' }" />
      <QuickActionTile :icon="ChartColumn" label="Estadísticas" :to="followedTeams[0] ? { name: 'team', params: { teamId: followedTeams[0].id }, query: { tab: 'estadisticas' } } : { name: 'matches' }" />
    </nav>

    <section v-if="sports.preview && !sports.loading.value">
      <SectionHeader title="Mis equipos" :to="{ name: 'profile', query: { tab: 'equipos' } }" />
      <div v-if="followedTeams.length" class="-mx-5 flex snap-x scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 scrollbar-none">
        <FollowedTeamCard
          v-for="team in followedTeams"
          :key="team.id"
          :team="team"
          :subtitle="[sports.competition(team.competition_id)?.name, team.country_name].filter(Boolean).join(' - ')"
          class="w-[72%] shrink-0 snap-start min-[380px]:w-[46%]"
        />
      </div>
      <p v-else class="app-surface px-4 py-5 text-center text-sm text-text-muted">Sigue equipos desde su ficha para verlos aquí.</p>
    </section>

    <section v-if="sports.preview && upcoming.length">
      <SectionHeader title="Próximos partidos" :to="{ name: 'matches' }" />
      <div class="space-y-3">
        <UpcomingMatchCard
          v-for="match in upcoming"
          :key="match.id"
          :match="match"
          :competition="sports.competition(match.tournament_id)"
          :home="sports.team(match.home_team_id)"
          :away="sports.team(match.away_team_id)"
          :now="sports.now.value"
        />
      </div>
    </section>

    <section>
      <SectionHeader title="Mis ligas" :to="myPools.pools.value.length ? { name: 'leagues' } : undefined" />
      <div v-if="myPools.loading.value" class="space-y-3">
        <LoadingSkeleton height="5.5rem" rounded="rounded-2xl" />
      </div>
      <ErrorState v-else-if="myPools.error.value" :description="myPools.error.value" />
      <div v-else-if="myPools.pools.value.length" class="space-y-3">
        <RouterLink v-for="pool in myPools.pools.value.slice(0, 2)" :key="pool.id" :to="{ name: 'pool', params: { poolId: pool.id } }" class="block">
          <PoolCard :name="pool.name" :status="pool.approval_status === 'pending' ? 'pending' : pool.status === 'archived' ? 'closed' : 'active'" />
        </RouterLink>
      </div>
      <EmptyState v-else :icon="Trophy" title="Aún no perteneces a ninguna liga" description="Únete con el código que te compartió tu organizador y compite con tu comunidad.">
        <template #action>
          <PrimaryButton @click="router.push({ name: 'league-join' })"><KeyRound class="h-4 w-4" />Unirme con código</PrimaryButton>
        </template>
      </EmptyState>
    </section>
  </section>
</template>
