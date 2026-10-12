<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CalendarClock, ChevronDown, ChevronUp, LoaderCircle, Trash2 } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import CatalogTeamPicker from '../components/CatalogTeamPicker.vue'
import ResultsModePanel from '../components/ResultsModePanel.vue'
import TeamBadge from '../components/TeamBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import SegmentedTabs from '../components/SegmentedTabs.vue'
import StatChip from '../components/StatChip.vue'
import { lockMinutesFromInterval } from '../lib/admin-contracts'
import { parseScoreInput } from '../lib/prediction-ux'
import {
  SPORT_OPTIONS, isoToZonedLocal, lockAtPreview, parseTeamLines, validateCountryCode, validateEntityName, validateKickoff,
  validateOptionalColor, validateScore, type MatchRow,
} from '../lib/sports-admin'
import { useAdmin } from '../composables/useAdmin'
import { useAuth } from '../composables/useAuth'
import { useIdentityWatch } from '../composables/useIdentityWatch'
import { useSportsAdmin } from '../composables/useSportsAdmin'

type Tab = 'teams' | 'rounds' | 'matches' | 'results'
const router = useRouter()
const auth = useAuth()
// Sin lectura de branding ni polling en la parrilla (FE-03).
const admin = useAdmin({ branding: false })
const sports = useSportsAdmin()

const tab = ref<Tab>('matches')
const tabs: { value: Tab; label: string }[] = [
  { value: 'teams', label: 'Equipos' }, { value: 'rounds', label: 'Jornadas' }, { value: 'matches', label: 'Partidos' }, { value: 'results', label: 'Resultados' },
]
const notice = ref('')
const formError = ref('')

// Torneo
const tournamentName = ref('')
const sportCode = ref('football')
const seasonLabel = ref('')
const countryCode = ref('')
const tournamentColor = ref('')
// Equipos
const bulkTeams = ref('')
// Jornadas
const roundName = ref('')
// Partido
const editingMatchId = ref('')
const matchRound = ref('')
const matchHome = ref('')
const matchAway = ref('')
const matchKickoff = ref('')
// Resultados
const scoreDraft = ref<Record<string, { home: string; away: string }>>({})

const lockOffsetMinutes = computed(() => (admin.selectedPool.value ? lockMinutesFromInterval(admin.selectedPool.value.lock_offset) : null))
const nextSortOrder = computed(() => (sports.rounds.value.length ? Math.max(...sports.rounds.value.map((round) => round.sort_order)) + 1 : 0))
const startedMatches = computed(() => sports.matches.value.filter((match) => new Date(match.starts_at).getTime() <= Date.now()))
const roundName_ = (id: string): string => sports.rounds.value.find((round) => round.id === id)?.name ?? '—'
const formatKickoff = (iso: string): string => new Intl.DateTimeFormat('es', { timeZone: sports.timezone.value, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

function fail(message: string | null): boolean {
  formError.value = message ?? ''
  return Boolean(message)
}
function ok(text: string): void { notice.value = text; formError.value = '' }

async function createTournament(): Promise<void> {
  if (fail(validateEntityName(tournamentName.value, 'El nombre del torneo') ?? validateCountryCode(countryCode.value) ?? validateOptionalColor(tournamentColor.value))) return
  if (fail(await sports.saveTournament({ name: tournamentName.value, sportCode: sportCode.value, countryCode: countryCode.value, seasonLabel: seasonLabel.value, color: tournamentColor.value }))) return
  tournamentName.value = ''; seasonLabel.value = ''; countryCode.value = ''; tournamentColor.value = ''
  ok('Torneo creado.')
}

async function addTeams(): Promise<void> {
  const { teams, rejected } = parseTeamLines(bulkTeams.value, sports.teams.value.map((team) => team.name))
  if (!teams.length) { fail(rejected.length ? 'Ninguna línea es válida o todas ya existen.' : 'Escribe al menos un equipo.'); return }
  if (fail(await sports.addTeamsInBulk(teams))) return
  bulkTeams.value = rejected.join('\n')
  ok(`${teams.length} equipo(s) añadidos${rejected.length ? `; ${rejected.length} línea(s) omitidas por duplicadas o inválidas` : ''}.`)
}

async function importFromCatalog(ids: string[]): Promise<void> {
  const outcome = await sports.importCatalogTeams(ids)
  if (fail(outcome.message)) return
  ok(`${outcome.enrolled} equipo(s) incorporados al torneo${outcome.alreadyEnrolled ? `; ${outcome.alreadyEnrolled} ya estaban inscritos` : ''}.`)
}

async function changeResultsMode(mode: 'manual' | 'automatic'): Promise<void> {
  if (fail(await sports.setResultsMode(mode))) return
  ok(mode === 'manual' ? 'Modo de resultados: manual.' : 'Modo de resultados: automático.')
}

async function toggleEnrolled(teamId: string): Promise<void> {
  if (fail(await sports.setEnrolled(teamId, !sports.enrolledTeamIds.value.includes(teamId)))) return
  ok('Inscripción actualizada.')
}

async function addRound(): Promise<void> {
  if (fail(validateEntityName(roundName.value, 'El nombre de la jornada'))) return
  if (fail(await sports.saveRound({ name: roundName.value, sortOrder: nextSortOrder.value }))) return
  roundName.value = ''; ok('Jornada creada.')
}

async function moveRound(index: number, step: -1 | 1): Promise<void> {
  const ids = sports.rounds.value.map((round) => round.id)
  const target = index + step
  if (target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  if (fail(await sports.reorderRounds(ids))) return
  ok('Orden actualizado.')
}

function resetMatchForm(): void { editingMatchId.value = ''; matchKickoff.value = '' }

function editMatch(match: MatchRow): void {
  editingMatchId.value = match.id; matchRound.value = match.round_id; matchHome.value = match.home_team_id; matchAway.value = match.away_team_id
  matchKickoff.value = isoToZonedLocal(match.starts_at, sports.timezone.value)
}

async function saveMatch(): Promise<void> {
  if (!matchRound.value || !matchHome.value || !matchAway.value) { fail('Elige jornada, local y visita.'); return }
  if (matchHome.value === matchAway.value) { fail('Local y visita deben ser equipos distintos.'); return }
  const kickoff = validateKickoff(matchKickoff.value, sports.timezone.value)
  if (fail(kickoff.error)) return
  if (fail(await sports.saveMatch({ id: editingMatchId.value || undefined, roundId: matchRound.value, homeTeamId: matchHome.value, awayTeamId: matchAway.value, startsAtIso: kickoff.iso! }))) return
  ok(editingMatchId.value ? 'Partido actualizado.' : 'Partido creado.'); resetMatchForm()
}

async function deleteMatch(id: string): Promise<void> {
  if (fail(await sports.removeMatch(id))) return
  ok('Partido eliminado.')
}

async function togglePool(matchId: string): Promise<void> {
  const pool = admin.selectedPool.value
  if (!pool) return
  if (fail(await sports.setPoolMatch(pool.id, matchId, !sports.poolMatchIds.value.includes(matchId)))) return
  ok('Parrilla de la quiniela actualizada.')
}

async function publish(match: MatchRow): Promise<void> {
  const draft = scoreDraft.value[match.id]
  // Un campo en blanco no es 0 (FE-01): se valida la cadena con la misma lógica que los pronósticos.
  const home = parseScoreInput(draft?.home ?? ''); const away = parseScoreInput(draft?.away ?? '')
  if (!home.ok) { fail(`Revisa el marcador del local. ${home.message}`); return }
  if (!away.ok) { fail(`Revisa el marcador de la visita. ${away.message}`); return }
  if (fail(validateScore(home.value) ?? validateScore(away.value))) return
  if (fail(await sports.publishResult(match.id, home.value, away.value))) return
  ok(sports.results.value[match.id]?.revision && sports.results.value[match.id]!.revision > 1 ? 'Resultado corregido.' : 'Resultado publicado.')
}

watch(() => admin.selectedTenantId.value, (id) => { if (id) void sports.loadCatalog(id) })
watch(() => sports.selectedTournamentId.value, () => { void sports.loadTournament() })
watch(() => admin.selectedPoolId.value, (id) => { void sports.loadPoolMatches(id) })
watch(() => sports.results.value, (results) => {
  for (const [id, result] of Object.entries(results)) scoreDraft.value[id] = { home: String(result.home_score), away: String(result.away_score) }
})
// Cambio de identidad con la vista montada (FE-05): el borrador de torneo/partidos/resultados pertenece
// a la sesión anterior; se descarta y se vuelve a Inicio (el guard re-evalúa el acceso al reabrir).
useIdentityWatch(auth, {
  onChange: () => { admin.reset(); void router.replace({ name: 'home' }) },
  onSignedOut: () => { admin.reset(); void router.replace({ name: 'home' }) },
})
onMounted(async () => { if (auth.state.user) await admin.load(auth.state.user.id) })
onBeforeUnmount(admin.dispose)
</script>

<template>
  <AppShell variant="app" active="fixture" title="Parrilla deportiva" :user-name="auth.state.profile?.display_name">
    <section class="space-y-6 pt-2">
      <div>
        <h1 class="font-display text-xl font-bold text-text">Parrilla deportiva</h1>
        <p class="mt-1 text-sm text-text-muted">Torneos, equipos, jornadas, partidos y resultados oficiales. Las horas se muestran en la zona horaria de tu organización ({{ sports.timezone.value }}).</p>
      </div>

      <div v-if="admin.loading.value || sports.loading.value" class="flex justify-center py-14 text-sm text-text-muted"><LoaderCircle class="mr-2 h-4 w-4 animate-spin" />Cargando…</div>
      <ErrorState v-else-if="admin.error.value || sports.error.value" :description="admin.error.value || sports.error.value" />
      <EmptyState v-else-if="!admin.tenants.value.length" :icon="CalendarClock" title="Sin acceso administrativo" description="Solo propietarios y administradores gestionan la parrilla.">
        <template #action><SecondaryButton @click="router.push({ name: 'admin' })">Volver a administración</SecondaryButton></template>
      </EmptyState>

      <template v-else>
        <label class="block text-sm font-medium text-text-muted">Organización
          <select v-model="admin.selectedTenantId.value" class="field-surface mt-1.5 w-full px-3 py-3 text-sm">
            <option v-for="tenant in admin.tenants.value" :key="tenant.tenant_id" :value="tenant.tenant_id">Tenant {{ tenant.tenant_id.slice(0, 8) }} · {{ tenant.role }}</option>
          </select>
        </label>

        <section class="app-surface space-y-3 p-4">
          <h2 class="font-display font-bold text-text">Torneo</h2>
          <label v-if="sports.tournaments.value.length" class="block text-sm font-medium text-text-muted">Torneo activo
            <select v-model="sports.selectedTournamentId.value" class="field-surface mt-1.5 w-full px-3 py-3 text-sm">
              <option v-for="tournament in sports.tournaments.value" :key="tournament.id" :value="tournament.id">{{ tournament.name }}{{ tournament.season_label ? ` · ${tournament.season_label}` : '' }}</option>
            </select>
          </label>
          <form class="space-y-3" @submit.prevent="createTournament">
            <FormField id="tournament-name" v-model="tournamentName" label="Nuevo torneo" :maxlength="120" placeholder="Liga Distrital 2026" />
            <div class="grid grid-cols-2 gap-3">
              <label class="block text-sm font-medium text-text-muted">Deporte
                <select v-model="sportCode" class="field-surface mt-1.5 w-full px-3 py-3 text-sm"><option v-for="sport in SPORT_OPTIONS" :key="sport.code" :value="sport.code">{{ sport.label }}</option></select>
              </label>
              <FormField id="tournament-season" v-model="seasonLabel" label="Temporada" :maxlength="40" placeholder="2026" />
              <FormField id="tournament-country" v-model="countryCode" label="País (ISO)" :maxlength="2" placeholder="PE" />
              <FormField id="tournament-color" v-model="tournamentColor" label="Color" placeholder="#00FF88" />
            </div>
            <PrimaryButton type="submit" :loading="sports.saving.value">Crear torneo</PrimaryButton>
          </form>
        </section>

        <EmptyState v-if="!sports.selectedTournament.value" :icon="CalendarClock" title="Crea tu primer torneo" description="Después podrás añadir equipos, jornadas y partidos." />

        <template v-else>
          <SegmentedTabs v-model="tab" :options="tabs" label="Secciones de la parrilla" variant="chip" />

          <section v-if="tab === 'teams'" class="app-surface space-y-4 p-4">
            <h2 class="font-display font-bold text-text">Equipos</h2>
            <CatalogTeamPicker :enrolled-names="sports.enrolledTeams.value.map((team) => team.name)" :importing="sports.saving.value" @import="importFromCatalog" />
            <h3 class="font-display font-bold text-text">¿Falta un equipo? Añádelo manualmente</h3>
            <label class="block text-sm font-medium text-text-muted">Alta exprés (uno por línea; «Nombre, ABR» opcional)
              <textarea v-model="bulkTeams" rows="5" class="field-surface mt-1.5 w-full px-3 py-3 text-sm" placeholder="Club Norte, CNO&#10;Club Sur, CSU" />
            </label>
            <PrimaryButton :loading="sports.saving.value" @click="addTeams">Añadir e inscribir en el torneo</PrimaryButton>
            <EmptyState v-if="!sports.teams.value.length" title="Aún no hay equipos" description="Añádelos arriba; se inscriben en el torneo activo." />
            <ul v-else class="divide-y divide-border">
              <li v-for="team in sports.teams.value" :key="team.id" class="flex items-center justify-between gap-3 py-2.5">
                <span class="flex items-center gap-2 text-sm font-semibold text-text"><TeamBadge :name="team.name" :kind="team.kind" :country-code="team.country_code" :short-name="team.short_name ?? undefined" size="xs" />{{ team.name }}<span v-if="team.short_name" class="ml-1 text-text-muted">{{ team.short_name }}</span></span>
                <label class="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" class="h-4 w-4 rounded accent-primary" :checked="sports.enrolledTeamIds.value.includes(team.id)" @change="toggleEnrolled(team.id)" />En el torneo</label>
              </li>
            </ul>
          </section>

          <section v-else-if="tab === 'rounds'" class="app-surface space-y-4 p-4">
            <h2 class="font-display font-bold text-text">Jornadas</h2>
            <form class="space-y-3" @submit.prevent="addRound">
              <FormField id="round-name" v-model="roundName" label="Nueva jornada" :maxlength="120" placeholder="Fecha 1" />
              <PrimaryButton type="submit" :loading="sports.saving.value">Añadir jornada</PrimaryButton>
            </form>
            <EmptyState v-if="!sports.rounds.value.length" title="Sin jornadas" description="Crea la primera para poder programar partidos." />
            <ul v-else class="divide-y divide-border">
              <li v-for="(round, index) in sports.rounds.value" :key="round.id" class="flex items-center justify-between gap-3 py-2.5">
                <span class="text-sm font-semibold text-text">{{ round.name }}</span>
                <span class="flex gap-1">
                  <button type="button" class="rounded-lg p-2 text-text-muted disabled:opacity-30" :disabled="index === 0" :aria-label="`Subir ${round.name}`" @click="moveRound(index, -1)"><ChevronUp class="h-4 w-4" /></button>
                  <button type="button" class="rounded-lg p-2 text-text-muted disabled:opacity-30" :disabled="index === sports.rounds.value.length - 1" :aria-label="`Bajar ${round.name}`" @click="moveRound(index, 1)"><ChevronDown class="h-4 w-4" /></button>
                </span>
              </li>
            </ul>
          </section>

          <section v-else-if="tab === 'matches'" class="app-surface space-y-4 p-4">
            <h2 class="font-display font-bold text-text">Partidos</h2>
            <p v-if="admin.selectedPool.value" class="text-sm text-text-muted">Quiniela seleccionada: <span class="font-semibold text-text">{{ admin.selectedPool.value.name }}</span> (cierre {{ lockOffsetMinutes }} min antes). Elige otra desde Administración.</p>
            <p v-else class="text-sm text-text-muted">Selecciona una quiniela en Administración para añadir partidos a su parrilla.</p>
            <EmptyState v-if="sports.enrolledTeams.value.length < 2 || !sports.rounds.value.length" title="Faltan datos" description="Necesitas al menos dos equipos inscritos y una jornada." />
            <form v-else class="space-y-3" @submit.prevent="saveMatch">
              <label class="block text-sm font-medium text-text-muted">Jornada<select v-model="matchRound" class="field-surface mt-1.5 w-full px-3 py-3 text-sm"><option value="" disabled>Elige…</option><option v-for="round in sports.rounds.value" :key="round.id" :value="round.id">{{ round.name }}</option></select></label>
              <div class="grid grid-cols-2 gap-3">
                <label class="block text-sm font-medium text-text-muted">Local<select v-model="matchHome" class="field-surface mt-1.5 w-full px-3 py-3 text-sm"><option value="" disabled>Elige…</option><option v-for="team in sports.enrolledTeams.value" :key="team.id" :value="team.id">{{ team.name }}</option></select></label>
                <label class="block text-sm font-medium text-text-muted">Visita<select v-model="matchAway" class="field-surface mt-1.5 w-full px-3 py-3 text-sm"><option value="" disabled>Elige…</option><option v-for="team in sports.enrolledTeams.value" :key="team.id" :value="team.id">{{ team.name }}</option></select></label>
              </div>
              <FormField id="match-kickoff" v-model="matchKickoff" type="datetime-local" label="Inicio" :hint="`Hora de ${sports.timezone.value}`" />
              <div class="flex gap-2">
                <PrimaryButton type="submit" :loading="sports.saving.value">{{ editingMatchId ? 'Guardar cambios' : 'Crear partido' }}</PrimaryButton>
                <SecondaryButton v-if="editingMatchId" :full-width="false" @click="resetMatchForm">Cancelar</SecondaryButton>
              </div>
            </form>
            <EmptyState v-if="!sports.matches.value.length" title="Sin partidos" description="Crea el primero con el formulario." />
            <ul v-else class="space-y-3">
              <li v-for="match in sports.matches.value" :key="match.id" class="rounded-xl border border-border p-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <p class="text-sm font-semibold text-text">{{ sports.teamName(match.home_team_id) }} vs {{ sports.teamName(match.away_team_id) }}</p>
                    <p class="text-xs text-text-muted">{{ roundName_(match.round_id) }} · {{ formatKickoff(match.starts_at) }}</p>
                    <p v-if="lockOffsetMinutes !== null && match.status === 'scheduled'" class="text-xs text-text-faint">Cierre estimado: {{ formatKickoff(lockAtPreview(match.starts_at, lockOffsetMinutes).toISOString()) }} (lo confirma el servidor)</p>
                  </div>
                  <StatChip :label="match.status === 'final' ? 'Final' : match.status === 'live' ? 'En juego' : 'Programado'" :tone="match.status === 'final' ? 'success' : match.status === 'live' ? 'warn' : 'neutral'" />
                </div>
                <div class="mt-3 flex flex-wrap items-center gap-2">
                  <SecondaryButton v-if="match.status === 'scheduled'" :full-width="false" @click="editMatch(match)">Editar</SecondaryButton>
                  <label v-if="admin.selectedPool.value && match.status === 'scheduled'" class="flex items-center gap-2 text-sm text-text-muted"><input type="checkbox" class="h-4 w-4 rounded accent-primary" :checked="sports.poolMatchIds.value.includes(match.id)" @change="togglePool(match.id)" />En la quiniela</label>
                  <button v-if="match.status === 'scheduled' && !sports.poolMatchIds.value.includes(match.id)" type="button" class="ml-auto rounded-lg p-2 text-danger" :aria-label="`Eliminar partido ${sports.teamName(match.home_team_id)} vs ${sports.teamName(match.away_team_id)}`" @click="deleteMatch(match.id)"><Trash2 class="h-4 w-4" /></button>
                </div>
              </li>
            </ul>
          </section>

          <section v-else class="app-surface space-y-4 p-4">
            <h2 class="font-display font-bold text-text">Resultados oficiales</h2>
            <ResultsModePanel :mode="sports.resultsMode.value" :auto-available="sports.autoResultsAvailable.value" :saving="sports.saving.value" @select="changeResultsMode" />
            <p class="text-sm text-text-muted">Publicar o corregir un resultado recalcula los puntos de forma idempotente. Cada corrección queda auditada.</p>
            <EmptyState v-if="!startedMatches.length" title="Aún no hay partidos iniciados" description="Los resultados se publican cuando el partido empieza." />
            <ul v-else class="space-y-3">
              <li v-for="match in startedMatches" :key="match.id" class="rounded-xl border border-border p-3">
                <div class="flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-text">{{ sports.teamName(match.home_team_id) }} vs {{ sports.teamName(match.away_team_id) }}</p>
                  <StatChip v-if="sports.results.value[match.id]" :label="`Rev. ${sports.results.value[match.id]!.revision}${sports.results.value[match.id]!.source === 'provider' ? ' · proveedor' : ''}`" tone="success" />
                </div>
                <div class="mt-3 flex items-end gap-2">
                  <FormField :id="`score-h-${match.id}`" :model-value="scoreDraft[match.id]?.home ?? ''" type="number" label="Local" @update:model-value="scoreDraft[match.id] = { home: $event, away: scoreDraft[match.id]?.away ?? '' }" />
                  <FormField :id="`score-a-${match.id}`" :model-value="scoreDraft[match.id]?.away ?? ''" type="number" label="Visita" @update:model-value="scoreDraft[match.id] = { home: scoreDraft[match.id]?.home ?? '', away: $event }" />
                  <PrimaryButton :full-width="false" :loading="sports.saving.value" @click="publish(match)">{{ sports.results.value[match.id] ? 'Corregir' : 'Publicar' }}</PrimaryButton>
                </div>
              </li>
            </ul>
          </section>
        </template>

        <p v-if="formError" class="rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger" role="alert">{{ formError }}</p>
        <p v-if="notice" class="rounded-xl bg-primary-100 p-3 text-sm font-medium text-primary" role="status">{{ notice }}</p>
      </template>
    </section>
  </AppShell>
</template>
