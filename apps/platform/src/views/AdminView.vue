<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Check, CircleAlert, Copy, KeyRound, LoaderCircle, Palette, Settings2, UsersRound } from 'lucide-vue-next'
import AppShell from '../components/AppShell.vue'
import BrandingAssetSlot from '../components/BrandingAssetSlot.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorState from '../components/ErrorState.vue'
import FormField from '../components/FormField.vue'
import PrimaryButton from '../components/PrimaryButton.vue'
import SecondaryButton from '../components/SecondaryButton.vue'
import StatChip from '../components/StatChip.vue'
import { freeLimitMessage, lockMinutesFromInterval, validatePoints, validatePoolName } from '../lib/admin-contracts'
import { useAdmin } from '../composables/useAdmin'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const auth = useAuth()
const admin = useAdmin()
const poolName = ref('')
const lockMinutes = ref('15')
const requiresApproval = ref(false)
const exactPoints = ref('3')
const outcomePoints = ref('1')
const tieBreaker = ref<'exact_predictions' | 'prediction_submitted_at'>('exact_predictions')
const primaryColor = ref('#2C48C7')
const secondaryColor = ref('#05070D')
const notice = ref('')
const formError = ref('')
const joinCode = ref('')
const brandingError = ref('')

const planLabel = computed(() => admin.selectedTenant.value?.plan_code === 'pro' ? 'PRO' : 'FREE')
const freeLimitNotice = computed(() => {
  const plan = admin.selectedTenant.value?.plan_code
  return plan ? freeLimitMessage(plan, admin.activePools.value) : null
})
const openingIsBlockedByFreeLimit = computed(() => (
  admin.selectedPool.value?.status === 'draft' && Boolean(freeLimitNotice.value)
))

async function refreshTenant(): Promise<void> {
  await Promise.all([admin.loadPools(), admin.loadBrandingAssets()])
}

async function savePool(): Promise<void> {
  formError.value = validatePoolName(poolName.value) ?? ''
  const minutes = Number(lockMinutes.value)
  if (!formError.value && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440)) formError.value = 'El bloqueo debe estar entre 0 y 1440 minutos.'
  if (formError.value) return
  const result = admin.selectedPool.value
    ? await admin.updatePool('update', poolName.value, minutes, requiresApproval.value)
    : await admin.createPool(poolName.value, minutes, requiresApproval.value)
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

async function saveRules(): Promise<void> {
  const exact = Number(exactPoints.value); const outcome = Number(outcomePoints.value)
  formError.value = validatePoints(exact, outcome) ?? ''
  if (formError.value) return
  const result = await admin.publishRules(exact, outcome, tieBreaker.value)
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
  if (!/^#[0-9A-Fa-f]{6}$/.test(primaryColor.value) || !/^#[0-9A-Fa-f]{6}$/.test(secondaryColor.value)) { formError.value = 'Usa colores hexadecimales de seis dígitos.'; return }
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
watch(() => admin.selectedTenantId.value, () => { void refreshTenant() })
onMounted(async () => { if (auth.state.user) await admin.load(auth.state.user.id) })
onBeforeUnmount(admin.dispose)
</script>

<template>
  <AppShell variant="app" active="home" title="Administración" :user-name="auth.state.profile?.display_name">
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
        <label class="block text-sm font-medium text-text-muted">Tenant administrado
          <select v-model="admin.selectedTenantId.value" class="field-surface mt-1.5 w-full px-3 py-3 text-sm">
            <option v-for="tenant in admin.tenants.value" :key="tenant.tenant_id" :value="tenant.tenant_id">Tenant {{ tenant.tenant_id.slice(0, 8) }} · {{ tenant.role }}</option>
          </select>
        </label>

        <section class="app-surface p-4">
          <div class="mb-4 flex items-center justify-between"><h2 class="font-display font-bold text-text">Quinielas</h2><StatChip :label="`${admin.activePools.value} activas`" /></div>
          <div v-if="freeLimitNotice" class="mb-4 flex gap-3 rounded-xl border border-warn/30 bg-warn-100/60 px-3.5 py-3 text-sm text-text-muted" role="status">
            <CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <p><span class="font-semibold text-text">{{ freeLimitNotice }}</span> Puedes guardar otra como borrador, pero no abrirla hasta archivar la actual.</p>
          </div>
          <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
            <button v-for="pool in admin.pools.value" :key="pool.id" type="button" class="shrink-0 rounded-xl border px-3 py-2 text-left text-sm" :class="admin.selectedPoolId.value === pool.id ? 'border-primary/60 bg-primary-100 text-primary' : 'border-border text-text-muted'" @click="choosePool(pool.id)">{{ pool.name }} · {{ pool.status }}</button>
            <button type="button" class="shrink-0 rounded-xl border border-dashed border-primary/50 px-3 py-2 text-sm font-semibold text-primary" @click="admin.selectedPoolId.value = ''; poolName = ''; lockMinutes = '15'; requiresApproval = false">+ Nueva</button>
          </div>
          <form class="space-y-3" @submit.prevent="savePool">
            <FormField id="admin-pool-name" v-model="poolName" label="Nombre de la quiniela" :maxlength="120" placeholder="Liga de amigos" />
            <FormField id="admin-lock-minutes" v-model="lockMinutes" type="number" label="Bloqueo antes del partido (minutos)" />
            <label class="flex items-center gap-2 text-sm text-text-muted"><input v-model="requiresApproval" type="checkbox" class="h-4 w-4 rounded accent-primary" /> Aprobar participantes manualmente</label>
            <PrimaryButton type="submit" :loading="admin.saving.value">{{ admin.selectedPool.value ? 'Guardar configuración' : 'Crear quiniela' }}</PrimaryButton>
          </form>
          <div v-if="admin.selectedPool.value" class="mt-3 grid grid-cols-3 gap-2">
            <SecondaryButton :disabled="admin.selectedPool.value.status === 'open' || admin.selectedPool.value.status === 'archived' || openingIsBlockedByFreeLimit" @click="changeStatus('open')">Abrir</SecondaryButton>
            <SecondaryButton :disabled="admin.selectedPool.value.status !== 'open'" @click="changeStatus('pause')">Pausar</SecondaryButton>
            <SecondaryButton tone="danger" :disabled="admin.selectedPool.value.status === 'archived'" @click="changeStatus('archive')">Archivar</SecondaryButton>
          </div>
          <p v-if="openingIsBlockedByFreeLimit" class="mt-2 text-sm text-warn">Archiva la quiniela activa para abrir esta.</p>
        </section>

        <template v-if="admin.selectedPool.value">
          <section class="app-surface p-4">
            <div class="mb-4 flex items-center gap-2"><Settings2 class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Reglas</h2></div>
            <div class="grid grid-cols-2 gap-3"><FormField id="exact-points" v-model="exactPoints" type="number" label="Puntos exacto" /><FormField id="outcome-points" v-model="outcomePoints" type="number" label="Puntos 1X2" /></div>
            <label class="mt-3 block text-sm font-medium text-text-muted">Desempate<select v-model="tieBreaker" class="field-surface mt-1.5 w-full px-3 py-3 text-sm"><option value="exact_predictions">Más resultados exactos</option><option value="prediction_submitted_at">Predicción más temprana</option></select></label>
            <PrimaryButton class="mt-3" :loading="admin.saving.value" @click="saveRules">Publicar nueva versión</PrimaryButton>
          </section>

          <section class="app-surface p-4">
            <div class="mb-4 flex items-center gap-2"><UsersRound class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Participantes</h2></div>
            <EmptyState v-if="!admin.participants.value.length" title="Aún no hay participantes" description="Comparte un código cuando la quiniela esté lista." />
            <div v-else class="space-y-3">
              <div v-for="participant in admin.participants.value" :key="participant.id" class="rounded-xl border border-border p-3">
                <div class="flex items-center justify-between gap-2"><p class="font-semibold text-text">{{ participant.profiles?.display_name ?? 'Participante' }}</p><StatChip :label="participant.approval_status === 'approved' ? 'Aprobado' : 'Pendiente'" :tone="participant.approval_status === 'approved' ? 'success' : 'warn'" /></div>
                <div class="mt-3 flex gap-2"><SecondaryButton v-if="participant.approval_status === 'pending'" :loading="admin.saving.value" @click="admin.approveParticipant(participant.id).then((result) => { if (result) formError = result })"><Check class="h-4 w-4" />Aprobar</SecondaryButton><select :value="participant.payment_status" class="field-surface min-w-0 flex-1 px-2 text-sm" @change="admin.setPayment(participant.id, ($event.target as HTMLSelectElement).value as 'paid' | 'pending' | 'invited').then((result) => { if (result) formError = result })"><option value="paid">Pagado</option><option value="pending">Pendiente</option><option value="invited">Invitado</option></select></div>
              </div>
            </div>
          </section>

          <section class="app-surface p-4"><div class="mb-3 flex items-center gap-2"><KeyRound class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Código de unión</h2></div><p v-if="joinCode" class="mb-3 rounded-xl bg-surface-2 p-3 text-center font-display text-xl font-bold tracking-[0.3em] text-text">{{ joinCode }}</p><div class="flex gap-2"><PrimaryButton :loading="admin.saving.value" @click="makeJoinCode">Generar código</PrimaryButton><SecondaryButton v-if="joinCode" :full-width="false" @click="copyJoinCode"><Copy class="h-4 w-4" />Copiar</SecondaryButton></div></section>
        </template>

        <section class="app-surface p-4">
          <div class="mb-3 flex items-center gap-2"><Palette class="h-5 w-5 text-primary" /><h2 class="font-display font-bold text-text">Branding</h2></div>
          <p class="mb-3 text-sm text-text-muted">{{ planLabel === 'PRO' ? 'Personaliza los colores y la identidad visual de tu quiniela.' : 'El branding personalizado requiere PRO.' }}</p>
          <div class="grid grid-cols-2 gap-3"><FormField id="primary-color" v-model="primaryColor" label="Color primario" :disabled="planLabel === 'FREE'" /><FormField id="secondary-color" v-model="secondaryColor" label="Color secundario" :disabled="planLabel === 'FREE'" /></div>
          <PrimaryButton class="mt-3" :disabled="planLabel === 'FREE'" :loading="admin.saving.value" @click="saveBranding">Guardar branding</PrimaryButton>

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
