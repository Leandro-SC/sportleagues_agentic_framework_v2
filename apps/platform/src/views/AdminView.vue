<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { BadgeCheck, CalendarClock, Check, CircleAlert, Copy, KeyRound, LoaderCircle, Palette, Settings2, UsersRound, Wallet } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import BrandingAssetSlot from '../components/BrandingAssetSlot.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import FormField from '../components/FormField.vue'
import PoolTicketsAdmin from '../components/PoolTicketsAdmin.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import ShareStudio from '../components/ShareStudio.vue'
import StatChip from '../components/StatChip.vue'
import { publicAppUrl, safeAccent } from '../lib/branding'
import { appLinkHosts } from '../lib/pwa'
import type { TenantBranding } from '../composables/useTenantBranding'
import { PRO_SCORING_MESSAGE, RULES_FROZEN_MESSAGE, STANDARD_SCORING, freeLimitMessage, lockMinutesFromInterval, parseLockMinutesInput, parsePointsInput, validatePoints, validatePoolName } from '../lib/admin-contracts'
import { BRANDING_COLORS_UNAVAILABLE, useAdmin } from '../composables/useAdmin'
import { useAuth } from '../composables/useAuth'
import { useIdentityWatch } from '../composables/useIdentityWatch'

const router = useRouter()
const auth = useAuth()
const admin = useAdmin()
const poolName = ref('')
const lockMinutes = ref('15')
const requiresApproval = ref(false)
const exactPoints = ref('3')
const outcomePoints = ref('1')
const tieBreaker = ref<'exact_predictions' | 'prediction_submitted_at'>('exact_predictions')
// Parten vacíos y se rellenan con los colores GUARDADOS del tenant (FE-02), nunca con valores de ejemplo.
const primaryColor = ref('')
const secondaryColor = ref('')
const notice = ref('')
const formError = ref('')
const joinCode = ref('')
const brandingError = ref('')
const brandNameInput = ref('')

// Invitación compartible por WhatsApp con la marca del organizador (nombre en todos los planes; logo y color en PRO).
const inviteBranding = computed<TenantBranding | null>(() => {
  const tenant = admin.selectedTenant.value
  if (!tenant) return null
  return {
    tenantId: tenant.tenant_id, plan: tenant.plan_code, brandName: admin.brandName.value,
    accent: tenant.plan_code === 'pro' ? safeAccent(admin.brandingColors.value?.primary) : null,
    logoUrl: admin.brandingAssets.value.logo?.signed_url ?? null, bannerUrl: admin.brandingAssets.value.banner?.signed_url ?? null, joinCode: joinCode.value || null,
  }
})
const inviteLink = computed(() => (joinCode.value ? publicAppUrl(appLinkHosts()[0]!, `/j/${joinCode.value}`) : null))
const inviteTemplates = computed(() => (joinCode.value && admin.selectedPool.value && inviteLink.value ? [{
  id: 'invite', label: 'Invitación', filename: 'invitacion', qrUrl: inviteLink.value, qrLabel: 'Escanea para unirte',
  input: { kind: 'invite' as const, poolName: admin.selectedPool.value.name, code: joinCode.value },
}] : []))

async function saveBrandName(): Promise<void> {
  const result = await admin.saveBrandName(brandNameInput.value)
  if (result) formError.value = result
  else { formError.value = ''; notice.value = admin.brandName.value ? `Tus jugadores verán «${admin.brandName.value}».` : 'Nombre de plataforma quitado.' }
}

const planLabel = computed(() => admin.selectedTenant.value?.plan_code === 'pro' ? 'PRO' : 'FREE')
const freeLimitNotice = computed(() => {
  const plan = admin.selectedTenant.value?.plan_code
  return plan ? freeLimitMessage(plan, admin.activePools.value) : null
})
const openingIsBlockedByFreeLimit = computed(() => (
  admin.selectedPool.value?.status === 'draft' && Boolean(freeLimitNotice.value)
))

async function refreshTenant(): Promise<void> {
  await Promise.all([admin.loadPools(), admin.loadBrandingAssets(), admin.loadBrandingColors()])
}

function resetForms(): void {
  poolName.value = ''; lockMinutes.value = '15'; requiresApproval.value = false
  exactPoints.value = '3'; outcomePoints.value = '1'; tieBreaker.value = 'exact_predictions'
  primaryColor.value = ''; secondaryColor.value = ''
  notice.value = ''; formError.value = ''; joinCode.value = ''; brandingError.value = ''
}

async function savePool(): Promise<void> {
  formError.value = validatePoolName(poolName.value) ?? ''
  if (formError.value) return
  // Un bloqueo en blanco no es 0 minutos (FE-01).
  const minutes = parseLockMinutesInput(lockMinutes.value)
  if (!minutes.ok) { formError.value = minutes.message; return }
  const result = admin.selectedPool.value
    ? await admin.updatePool('update', poolName.value, minutes.value, requiresApproval.value)
    : await admin.createPool(poolName.value, minutes.value, requiresApproval.value)
  if (result) { formError.value = result; return }
  notice.value = admin.selectedPool.value ? 'Configuración guardada.' : 'Quiniela creada.'
  if (!admin.selectedPool.value && admin.pools.value[0]) choosePool(admin.pools.value[0].id)
}

function choosePool(poolId: string): void {
  admin.selectedPoolId.value = poolId
  const pool = admin.pools.value.find((item) => item.id === poolId)
  if (pool) { poolName.value = pool.name; lockMinutes.value = String(lockMinutesFromInterval(pool.lock_offset)); requiresApproval.value = pool.requires_approval }
  void admin.loadPoolDetails()
}

async function changeStatus(action: 'open' | 'pause' | 'archive'): Promise<void> {
  const result = await admin.updatePool(action)
  if (result) formError.value = result
  else notice.value = action === 'archive' ? 'Quiniela archivada.' : action === 'pause' ? 'Quiniela pausada.' : 'Quiniela abierta.'
}

// ADR-023: sin política del servidor (RPC ausente) la UI no bloquea; el servidor decide y se traduce su rechazo.
const rulesFrozen = computed(() => admin.rulesPolicy.value?.editable === false)
const customScoringLocked = computed(() => admin.rulesPolicy.value?.customAllowed === false)

async function saveRules(): Promise<void> {
  if (rulesFrozen.value) { formError.value = RULES_FROZEN_MESSAGE; return }
  if (customScoringLocked.value) { exactPoints.value = String(STANDARD_SCORING.exactPoints); outcomePoints.value = String(STANDARD_SCORING.outcomePoints) }
  // Puntos en blanco no son 0 (FE-01).
  const exact = parsePointsInput(exactPoints.value, 'Puntos exacto')
  if (!exact.ok) { formError.value = exact.message; return }
  const outcome = parsePointsInput(outcomePoints.value, 'Puntos 1X2')
  if (!outcome.ok) { formError.value = outcome.message; return }
  formError.value = validatePoints(exact.value, outcome.value) ?? ''
  if (formError.value) return
  const result = await admin.publishRules(exact.value, outcome.value, tieBreaker.value)
  if (result) formError.value = result; else notice.value = 'Nueva versión de reglas publicada.'
}

async function makeJoinCode(): Promise<void> {
  const result = await admin.createJoinCode()
  if (result.error) formError.value = result.error
  else { joinCode.value = result.code ?? ''; notice.value = 'Código de unión generado.' }
}

async function copyJoinCode(): Promise<void> {
  if (!joinCode.value) return
  await navigator.clipboard?.writeText(joinCode.value)
  notice.value = 'Código copiado.'
}

async function saveBranding(): Promise<void> {
  // Sin los colores actuales del tenant no se guarda nada: se pisarían a ciegas (FE-02).
  if (admin.brandingColorsStatus.value !== 'ready') { formError.value = BRANDING_COLORS_UNAVAILABLE; return }
  const valid = (value: string): boolean => value.trim() === '' || /^#[0-9A-Fa-f]{6}$/.test(value.trim())
  if (!valid(primaryColor.value) || !valid(secondaryColor.value)) { formError.value = 'Usa colores hexadecimales de seis dígitos.'; return }
  const result = await admin.saveBranding(primaryColor.value, secondaryColor.value)
  if (result) formError.value = result; else notice.value = 'Branding guardado.'
}

async function uploadBrandingAsset(kind: 'logo' | 'banner', file: File): Promise<void> {
  brandingError.value = ''
  const result = await admin.uploadBrandingAsset(kind, file)
  if (result) brandingError.value = result
  else notice.value = `${kind === 'logo' ? 'Logo' : 'Banner'} actualizado.`
}

async function removeBrandingAsset(kind: 'logo' | 'banner'): Promise<void> {
  brandingError.value = ''
  const result = await admin.removeBrandingAsset(kind)
  if (result) brandingError.value = result
  else notice.value = `${kind === 'logo' ? 'Logo' : 'Banner'} eliminado.`
}

watch(() => admin.selectedPool.value, (pool) => {
  if (!pool) return
  poolName.value = pool.name
  lockMinutes.value = String(lockMinutesFromInterval(pool.lock_offset))
  requiresApproval.value = pool.requires_approval
})
watch(() => admin.rule.value, (rule) => {
  if (!rule) return
  exactPoints.value = String(rule.exact_points); outcomePoints.value = String(rule.outcome_points); tieBreaker.value = rule.tie_breaker
})
watch(() => admin.brandingColors.value, (colors) => {
  primaryColor.value = colors?.primary ?? ''
  secondaryColor.value = colors?.secondary ?? ''
}, { immediate: true })
watch(() => admin.brandName?.value, (name) => { brandNameInput.value = name ?? '' }, { immediate: true })
// Solo el cambio de organización por el selector recarga: `load()` ya trae pools/branding/colores
// del tenant inicial y no debe duplicarse al fijar `selectedTenantId` (FE-03).
watch(() => admin.selectedTenantId.value, () => { if (!admin.loading.value) void refreshTenant() })
useIdentityWatch(auth, {
  onChange: (userId) => { admin.reset(); resetForms(); void admin.load(userId) },
  onSignedOut: () => { admin.reset(); resetForms(); void router.replace({ name: 'home' }) },
})
onMounted(async () => { if (auth.state.user) await admin.load(auth.state.user.id) })
onBeforeUnmount(admin.dispose)
</script>

<template>
  <AppShell variant="app" active="pools" title="Administración" :user-name="auth.state.profile?.display_name">
    <section class="space-y-6 pt-2">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h1 class="font-display text-xl font-bold text-text">Panel de organizador</h1>
          <p class="mt-1 text-sm text-text-muted">Gestiona quinielas y participantes desde un solo lugar.</p>
        </div>
        <StatChip :label="planLabel" :tone="planLabel === 'PRO' ? 'brand' : 'neutral'" />
      </div>

      <div v-if="admin.loading.value" class="flex justify-center py-14 text-sm text-text-muted"><LoaderCircle class="mr-2 h-4 w-4 animate-spin" />Cargando administración…</div>
      <ErrorState v-else-if="admin.error.value" :description="admin.error.value" />
      <EmptyState v-else-if="!admin.tenants.value.length" :icon="Settings2" title="Sin acceso administrativo" description="Solo propietarios y administradores pueden gestionar una quiniela.">
        <template #action><SecondaryButton @click="router.push({ name: 'home' })">Volver al inicio</SecondaryButton></template>
      </EmptyState>

      <template v-else>
        <label class="block text-sm font-medium text-text-muted">Organización administrada
          <select v-model="admin.selectedTenantId.value" class="field-surface mt-1.5 w-full px-3 py-3 text-sm">
            <option v-for="tenant in admin.tenants.value" :key="tenant.tenant_id" :value="tenant.tenant_id">Organización {{ tenant.tenant_id.slice(0, 8) }} · {{ tenant.role === 'owner' ? 'Propietario' : 'Administrador' }}</option>
          </select>
        </label>

        <button type="button" class="app-surface flex w-full items-center justify-between gap-3 p-4 text-left" @click="router.push({ name: 'admin-fixture' })">
          <span class="flex items-center gap-2 font-display font-bold text-text"><CalendarClock class="h-5 w-5 text-primary" />Parrilla deportiva</span>
          <span class="text-xs text-text-muted">Torneos, equipos y partidos →</span>
        </button>

        <button type="button" class="app-surface flex w-full items-center justify-between gap-3 p-4 text-left" @click="router.push({ name: 'admin-income' })">
          <span class="flex items-center gap-2 font-display font-bold text-text"><Wallet class="h-5 w-5 text-primary" />Mis finanzas</span>
          <span class="text-xs text-text-muted">Estado de pagos manuales →</span>
        </button>

        <section class="app-surface p-4">
          <div class="mb-4 flex items-center justify-between"><h2 class="font-display font-bold text-text">Quinielas</h2><StatChip :label="`${admin.activePools.value} activas`" /></div>
          <div v-if="freeLimitNotice" class="mb-4 flex gap-3 rounded-xl border border-warn/30 bg-warn-100/60 px-3.5 py-3 text-sm text-text-muted" role="status">
            <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <p><span class="font-semibold text-text">{{ freeLimitNotice }}</span> Puedes guardar otra como borrador, pero no abrirla hasta archivar la actual.</p>
          </div>
          <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
            <button v-for="pool in admin.pools.value" :key="pool.id" type="button" class="min-h-11 shrink-0 rounded-xl border px-3 py-2 text-left text-sm" :class="admin.selectedPoolId.value === pool.id ? 'border-primary/60 bg-primary-100 text-primary' : 'border-border text-text-muted'" @click="choosePool(pool.id)">{{ pool.name }} · {{ pool.status }}</button>
            <button type="button" class="min-h-11 shrink-0 rounded-xl border border-dashed border-primary/50 px-3 py-2 text-sm font-semibold text-primary" @click="admin.selectedPoolId.value = ''; poolName = ''; lockMinutes = '15'; requiresApproval = false">+ Nueva</button>
          </div>
          <form class="space-y-3" @submit.prevent="savePool">
            <FormField id="admin-pool-name" v-model="poolName" label="Nombre de la quiniela" :maxlength="120" placeholder="Liga de amigos" />
            <FormField id="admin-lock-minutes" v-model="lockMinutes" type="number" label="Bloqueo antes del partido (minutos)" />
            <label class="flex min-h-11 items-center gap-2 text-sm text-text-muted"><input v-model="requiresApproval" type="checkbox" class="h-5 w-5 rounded accent-primary" /> Aprobar participantes manualmente</label>
            <PrimaryButton type="submit" :loading="admin.saving.value">{{ admin.selectedPool.value ? 'Guardar configuración' : 'Crear quiniela' }}</PrimaryButton>
          </form>
          <div v-if="admin.selectedPool.value" class="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
            <SecondaryButton :disabled="admin.selectedPool.value.status === 'open' || admin.selectedPool.value.status === 'archived' || openingIsBlockedByFreeLimit" @click="changeStatus('open')">Abrir</SecondaryButton>
            <SecondaryButton :disabled="admin.selectedPool.value.status !== 'open'" @click="changeStatus('pause')">Pausar</SecondaryButton>
            <SecondaryButton tone="danger" :disabled="admin.selectedPool.value.status === 'archived'" @click="changeStatus('archive')">Archivar</SecondaryButton>
          </div>
          <p v-if="openingIsBlockedByFreeLimit" class="mt-2 text-sm text-warn">Archiva la quiniela activa para abrir esta.</p>
        </section>

        <template v-if="admin.selectedPool.value">
          <section class="app-surface p-4">
            <div class="mb-4 flex items-center gap-2"><Settings2 class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Reglas</h2></div>
            <div class="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2"><FormField id="exact-points" v-model="exactPoints" type="number" label="Puntos exacto" :disabled="rulesFrozen || customScoringLocked" /><FormField id="outcome-points" v-model="outcomePoints" type="number" label="Puntos 1X2" :disabled="rulesFrozen || customScoringLocked" /></div>
            <label class="mt-3 block text-sm font-medium text-text-muted">Desempate<select id="tie-breaker" v-model="tieBreaker" :disabled="rulesFrozen" class="field-surface mt-1.5 w-full px-3 py-3 text-sm disabled:opacity-50"><option value="exact_predictions">Más resultados exactos</option><option value="prediction_submitted_at">Predicción más temprana</option></select></label>
            <p v-if="rulesFrozen" class="mt-3 text-sm text-text-muted" data-testid="rules-frozen">{{ RULES_FROZEN_MESSAGE }}</p>
            <p v-else-if="customScoringLocked" class="mt-3 text-sm text-text-muted" data-testid="rules-standard">{{ PRO_SCORING_MESSAGE }}</p>
            <PrimaryButton v-if="!rulesFrozen" class="mt-3" :loading="admin.saving.value" @click="saveRules">Publicar nueva versión</PrimaryButton>
          </section>

          <PoolTicketsAdmin :pool-id="admin.selectedPool.value.id" :ticketing-mode="admin.selectedPool.value.ticketing_mode ?? 'none'" :archived="admin.selectedPool.value.status === 'archived'" @changed="admin.loadPools()" />

          <section class="app-surface p-4">
            <div class="mb-4 flex items-center gap-2"><UsersRound class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Participantes</h2></div>
            <EmptyState v-if="!admin.participants.value.length" title="Aún no hay participantes" description="Comparte un código cuando la quiniela esté lista." />
            <div v-else class="space-y-3">
              <div v-for="participant in admin.participants.value" :key="participant.id" class="rounded-xl border border-border p-3">
                <div class="flex items-center justify-between gap-2"><p class="font-semibold text-text">{{ participant.profiles?.display_name ?? 'Participante' }}</p><StatChip :label="participant.approval_status === 'approved' ? 'Aprobado' : 'Pendiente'" :tone="participant.approval_status === 'approved' ? 'success' : 'warn'" /></div>
                <div class="mt-3 flex flex-wrap gap-2"><SecondaryButton v-if="participant.approval_status === 'pending'" :loading="admin.saving.value" @click="admin.approveParticipant(participant.id).then((result) => { if (result) formError = result })"><Check class="h-4 w-4" />Aprobar</SecondaryButton><select :value="participant.payment_status" class="field-surface min-w-0 flex-1 px-2 text-sm" @change="admin.setPayment(participant.id, ($event.target as HTMLSelectElement).value as 'paid' | 'pending' | 'invited').then((result) => { if (result) formError = result })"><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="invited">Invitado</option></select></div>
              </div>
            </div>
          </section>

          <section class="app-surface p-4"><div class="mb-3 flex items-center gap-2"><KeyRound class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Código de unión</h2></div><p v-if="joinCode" class="mb-3 rounded-xl bg-surface-2 p-3 text-center font-display text-xl font-bold tracking-[0.3em] text-text">{{ joinCode }}</p><div class="flex gap-2"><PrimaryButton :loading="admin.saving.value" @click="makeJoinCode">Generar código</PrimaryButton><SecondaryButton v-if="joinCode" :full-width="false" @click="copyJoinCode"><Copy class="h-4 w-4" />Copiar</SecondaryButton></div><div v-if="inviteTemplates.length" class="mt-3"><ShareStudio :templates="inviteTemplates" :branding="inviteBranding" :link="inviteLink" button-label="Compartir invitación por WhatsApp" /></div></section>
        </template>

        <section class="app-surface p-4" data-testid="brand-name-section">
          <div class="mb-3 flex items-center gap-2"><BadgeCheck class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Tu plataforma</h2></div>
          <FormField id="brand-name" v-model="brandNameInput" label="Nombre de tu plataforma" placeholder="Ej.: Quinielas Silva" :maxlength="60"
            hint="Tus jugadores lo verán en tus quinielas y en las imágenes que compartas por WhatsApp." :disabled="admin.brandingColorsStatus.value === 'loading'" />
          <PrimaryButton class="mt-3" :loading="admin.saving.value" data-testid="save-brand-name" @click="saveBrandName">Guardar nombre</PrimaryButton>
        </section>

        <section class="app-surface p-4">
          <div class="mb-3 flex items-center gap-2"><Palette class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Branding</h2></div>
          <p class="mb-3 text-sm text-text-muted">{{ planLabel === 'PRO' ? 'Personaliza los colores y la identidad visual de tu quiniela.' : 'El branding personalizado requiere PRO.' }}</p>
          <p v-if="planLabel === 'PRO' && admin.brandingColorsStatus.value === 'error'" class="mb-3 text-sm text-warn" role="status">{{ BRANDING_COLORS_UNAVAILABLE }}</p>
          <div class="grid grid-cols-2 gap-3"><FormField id="primary-color" v-model="primaryColor" label="Color primario" placeholder="#2C48C7" :disabled="planLabel === 'FREE'" /><FormField id="secondary-color" v-model="secondaryColor" label="Color secundario" placeholder="#05070D" :disabled="planLabel === 'FREE'" /></div>
          <PrimaryButton class="mt-3" :disabled="planLabel === 'FREE' || admin.brandingColorsStatus.value !== 'ready'" :loading="admin.saving.value" @click="saveBranding">Guardar branding</PrimaryButton>

          <div class="mt-6 border-t border-border pt-5">
            <div class="mb-4"><h3 class="font-display text-base font-bold text-text">Identidad visual</h3><p class="mt-1 text-sm text-text-muted">Las imágenes se optimizan y se guardan de forma privada.</p></div>
            <div class="grid gap-6 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] md:items-start">
              <BrandingAssetSlot kind="logo" :plan="admin.selectedTenant.value?.plan_code ?? 'free'" :asset="admin.brandingAssets.value.logo" :busy="admin.brandingSaving.value" :error="brandingError" @upload="uploadBrandingAsset('logo', $event)" @remove="removeBrandingAsset('logo')" />
              <BrandingAssetSlot kind="banner" :plan="admin.selectedTenant.value?.plan_code ?? 'free'" :asset="admin.brandingAssets.value.banner" :busy="admin.brandingSaving.value" :error="brandingError" @upload="uploadBrandingAsset('banner', $event)" @remove="removeBrandingAsset('banner')" />
            </div>
          </div>
        </section>

        <p v-if="formError" class="rounded-xl bg-danger-100 p-3 text-sm font-medium text-danger" role="alert">{{ formError }}</p>
        <p v-if="notice" class="rounded-xl bg-primary-100 p-3 text-sm font-medium text-primary">{{ notice }}</p>
      </template>
    </section>
  </AppShell>
</template>
