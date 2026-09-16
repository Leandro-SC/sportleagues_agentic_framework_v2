import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

import {
  BRANDING_BUCKET,
  CLAIM_TIMEOUT_MS,
  DEFAULT_BATCH_SIZE,
  MAX_BATCH_SIZE,
  ORPHAN_GRACE_PERIOD_MS,
  ORPHAN_TENANT_SCAN_LIMIT,
  PENDING_TIMEOUT_MS,
  constantTimeEqual,
  isOlderThan,
  isStorageNotFound,
  isUuid,
  json,
  parseCanonicalStoragePath,
  summaryResponse,
  type AssetStatus,
} from './_shared.ts'

type ReconciliationAsset = {
  asset_id: string
  storage_path: string
  source_status: AssetStatus
  reconciliation_token: string
}

type AssetLookup = { asset_id: string; storage_path: string; status: AssetStatus }
type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
type ReconcilerDatabase = {
  public: {
    Tables: Record<never, never>
    Views: Record<never, never>
    Functions: {
      claim_branding_assets_for_reconciliation: {
        Args: { p_batch_size: number; p_pending_before: string; p_claim_timeout: string }
        Returns: ReconciliationAsset[]
      }
      complete_branding_asset_reconciliation: { Args: { p_asset_id: string; p_reconciliation_token: string }; Returns: boolean }
      release_branding_asset_reconciliation_claim: { Args: { p_asset_id: string; p_reconciliation_token: string }; Returns: boolean }
      get_branding_asset_for_reconciliation: { Args: { p_asset_id: string; p_storage_path: string }; Returns: AssetLookup[] }
      record_branding_reconciliation_issue: { Args: { p_asset_id: string; p_issue: string }; Returns: boolean }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

type ReconcilerClient = SupabaseClient<ReconcilerDatabase>
type RunSummary = { processed: number; deleted: number; skipped: number; errors: number; inconsistencies: number }
type StorageEntry = { name: string; created_at?: string | null; id?: string | null }

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`missing ${name}`)
  return value
}

function requestSecret(request: Request): string | null {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  return bearer ?? request.headers.get('x-reconciler-secret')
}

function log(runId: string, action: string, result: 'ok' | 'skip' | 'error', assetId?: string): void {
  console.log(JSON.stringify({ run_id: runId, asset_id: assetId, action, result }))
}

function increment(summary: RunSummary, key: keyof RunSummary): void {
  summary[key] += 1
}

async function objectMissingOrRemoved(client: ReconcilerClient, path: string): Promise<'removed' | 'retry'> {
  const { error } = await client.storage.from(BRANDING_BUCKET).remove([path])
  if (!error || isStorageNotFound(error)) return 'removed'
  return 'retry'
}

async function releaseClaim(client: ReconcilerClient, asset: ReconciliationAsset): Promise<boolean> {
  const { data, error } = await client.rpc('release_branding_asset_reconciliation_claim', {
    p_asset_id: asset.asset_id,
    p_reconciliation_token: asset.reconciliation_token,
  })
  return !error && data === true
}

async function processClaimedAsset(client: ReconcilerClient, asset: ReconciliationAsset, summary: RunSummary, runId: string): Promise<void> {
  increment(summary, 'processed')
  if (asset.source_status === 'active') {
    const { error } = await client.storage.from(BRANDING_BUCKET).download(asset.storage_path)
    if (error && isStorageNotFound(error)) {
      await client.rpc('record_branding_reconciliation_issue', { p_asset_id: asset.asset_id, p_issue: 'active_object_missing' })
      increment(summary, 'inconsistencies')
      log(runId, 'active_object_missing', 'error', asset.asset_id)
    } else if (error) {
      increment(summary, 'errors')
      log(runId, 'active_object_check', 'error', asset.asset_id)
      return
    }
    if (!await releaseClaim(client, asset)) increment(summary, 'skipped')
    else log(runId, 'active_object_check', 'ok', asset.asset_id)
    return
  }

  if (await objectMissingOrRemoved(client, asset.storage_path) === 'retry') {
    increment(summary, 'errors')
    log(runId, 'storage_cleanup', 'error', asset.asset_id)
    return
  }

  const { data: completed, error } = await client.rpc('complete_branding_asset_reconciliation', {
    p_asset_id: asset.asset_id,
    p_reconciliation_token: asset.reconciliation_token,
  })
  if (error) {
    increment(summary, 'errors')
    log(runId, 'mark_deleted', 'error', asset.asset_id)
  } else if (completed) {
    increment(summary, 'deleted')
    log(runId, 'mark_deleted', 'ok', asset.asset_id)
  } else {
    increment(summary, 'skipped')
    log(runId, 'mark_deleted', 'skip', asset.asset_id)
  }
}

async function processOrphans(client: ReconcilerClient, remaining: number, summary: RunSummary, runId: string): Promise<void> {
  if (remaining <= 0) return
  const { data: tenants, error: tenantsError } = await client.storage.from(BRANDING_BUCKET).list('', {
    limit: ORPHAN_TENANT_SCAN_LIMIT,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (tenantsError) {
    increment(summary, 'errors')
    log(runId, 'orphan_root_scan', 'error')
    return
  }

  let inspected = 0
  for (const tenant of (tenants ?? []) as StorageEntry[]) {
    if (inspected >= remaining || !isUuid(tenant.name)) continue
    const { data: objects, error } = await client.storage.from(BRANDING_BUCKET).list(tenant.name, {
      limit: Math.min(MAX_BATCH_SIZE, remaining - inspected),
      sortBy: { column: 'name', order: 'asc' },
    })
    if (error) {
      increment(summary, 'errors')
      log(runId, 'orphan_tenant_scan', 'error')
      continue
    }
    for (const object of (objects ?? []) as StorageEntry[]) {
      if (inspected >= remaining) break
      inspected += 1
      const path = `${tenant.name}/${object.name}`
      const parsed = parseCanonicalStoragePath(path)
      if (!parsed || parsed.tenantId !== tenant.name || !isOlderThan(object.created_at, ORPHAN_GRACE_PERIOD_MS)) {
        increment(summary, 'skipped')
        continue
      }
      increment(summary, 'processed')
      const { data, error: lookupError } = await client.rpc('get_branding_asset_for_reconciliation', {
        p_asset_id: parsed.assetId,
        p_storage_path: path,
      })
      const asset = data?.[0]
      if (lookupError) {
        increment(summary, 'errors')
        log(runId, 'orphan_lookup', 'error', parsed.assetId)
      } else if (!asset) {
        if (await objectMissingOrRemoved(client, path) === 'removed') {
          increment(summary, 'deleted')
          log(runId, 'orphan_removed', 'ok', parsed.assetId)
        } else {
          increment(summary, 'errors')
          log(runId, 'orphan_removed', 'error', parsed.assetId)
        }
      } else if (asset.status === 'deleted') {
        await client.rpc('record_branding_reconciliation_issue', { p_asset_id: asset.asset_id, p_issue: 'deleted_object_present' })
        increment(summary, 'inconsistencies')
        log(runId, 'deleted_object_present', 'error', asset.asset_id)
      } else {
        increment(summary, 'skipped')
      }
    }
  }
}

Deno.serve(async (request) => {
  const runId = crypto.randomUUID()
  const summary: RunSummary = { processed: 0, deleted: 0, skipped: 0, errors: 0, inconsistencies: 0 }
  try {
    if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' }, 405)
    const expectedSecret = requiredEnvironment('BRANDING_RECONCILER_SECRET')
    const receivedSecret = requestSecret(request)
    if (!receivedSecret || !await constantTimeEqual(expectedSecret, receivedSecret)) {
      return json({ code: 'UNAUTHORIZED', message: 'No autorizado.' }, 401)
    }

    const client = createClient<ReconcilerDatabase>(requiredEnvironment('SUPABASE_URL'), requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const now = Date.now()
    log(runId, 'run_started', 'ok')
    const { data: assets, error } = await client.rpc('claim_branding_assets_for_reconciliation', {
      p_batch_size: DEFAULT_BATCH_SIZE,
      p_pending_before: new Date(now - PENDING_TIMEOUT_MS).toISOString(),
      p_claim_timeout: `${CLAIM_TIMEOUT_MS / 60000} minutes`,
    })
    if (error) throw new Error('claim failed')
    for (const asset of assets ?? []) await processClaimedAsset(client, asset, summary, runId)
    await processOrphans(client, Math.max(0, DEFAULT_BATCH_SIZE - summary.processed), summary, runId)
    log(runId, 'run_finished', summary.errors ? 'error' : 'ok')
    return json(summaryResponse(runId, summary.processed, summary.deleted, summary.skipped, summary.errors, summary.inconsistencies), 200)
  } catch {
    increment(summary, 'errors')
    log(runId, 'run_failed', 'error')
    return json({ code: 'INTERNAL_ERROR', ...summaryResponse(runId, summary.processed, summary.deleted, summary.skipped, summary.errors, summary.inconsistencies) }, 500)
  }
})
