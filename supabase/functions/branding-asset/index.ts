import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0'

import {
  BRANDING_BUCKET,
  BRANDING_LIMITS,
  MAX_MULTIPART_OVERHEAD_BYTES,
  BrandingAssetError,
  allowedCorsHeaders,
  isAllowedCorsOrigin,
  isAssetKind,
  isStorageConflict,
  isUuid,
  mapRpcError,
  responseJson,
  safeError,
} from './_shared.ts'
import { normalizeToWebp } from './image-normalization.ts'
import { assertDimensions, assertFileSize, detectImageType, readHeaderDimensions } from './image-validation.ts'

type PendingAsset = {
  asset_id: string
  tenant_id: string
  storage_path: string
  asset_kind: 'logo' | 'banner'
}

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type BrandingDatabase = {
  public: {
    Tables: Record<never, never>
    Views: Record<never, never>
    Functions: {
      get_pending_branding_asset_for_upload: {
        Args: { p_asset_id: string }
        Returns: PendingAsset[]
      }
      record_verified_branding_asset: {
        Args: { p_asset_id: string; p_mime_type: string; p_byte_size: number; p_width: number; p_height: number; p_sha256: string }
        Returns: Json
      }
      activate_branding_asset: {
        Args: { p_asset_id: string }
        Returns: Json
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

type BrandingClient = SupabaseClient<BrandingDatabase>

type Stage = 'request' | 'authorization' | 'validation' | 'normalization' | 'storage' | 'metadata' | 'activation'

function logEvent(requestId: string, assetId: string | undefined, stage: Stage, result: 'ok' | 'error', startedAt: number): void {
  console.log(JSON.stringify({ request_id: requestId, asset_id: assetId, stage, result, duration_ms: Date.now() - startedAt }))
}

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw safeError('INTERNAL_ERROR')
  return value
}

function bearerToken(request: Request): string {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) throw safeError('UNAUTHORIZED')
  return match[1]
}

function maxRequestBytes(): number {
  return Math.max(...Object.values(BRANDING_LIMITS).map((limits) => limits.maxBytes)) + MAX_MULTIPART_OVERHEAD_BYTES
}

function assertContentLength(request: Request): void {
  const header = request.headers.get('content-length')
  if (!header) return
  const bytes = Number(header)
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxRequestBytes()) throw safeError('FILE_TOO_LARGE')
}

function getSingleUpload(formData: FormData): File {
  const files = Array.from(formData.entries())
    .filter(([, value]) => value instanceof File)
  const namedFiles = formData.getAll('file')
  if (files.length !== 1 || namedFiles.length !== 1 || !(namedFiles[0] instanceof File)) throw safeError('FILE_REQUIRED')
  return namedFiles[0]
}

function getAssetId(formData: FormData): string {
  const assetIds = formData.getAll('asset_id')
  if (assetIds.length !== 1 || typeof assetIds[0] !== 'string' || !isUuid(assetIds[0])) throw safeError('ASSET_NOT_FOUND')
  return assetIds[0]
}

async function resolvePendingAsset(userClient: BrandingClient, assetId: string): Promise<PendingAsset> {
  const { data, error } = await userClient.rpc('get_pending_branding_asset_for_upload', { p_asset_id: assetId })
  if (error) throw mapRpcError(error.message)
  const row = data?.[0]
  if (!row || !isAssetKind(row.asset_kind) || typeof row.asset_id !== 'string' || typeof row.tenant_id !== 'string' || typeof row.storage_path !== 'string') {
    throw safeError('INTERNAL_ERROR')
  }
  return row
}

async function storedObjectMatches(
  adminClient: BrandingClient,
  path: string,
  expectedSha256: string,
  maxBytes: number,
): Promise<boolean> {
  const { data, error } = await adminClient.storage.from(BRANDING_BUCKET).download(path)
  if (error || !data || data.size > maxBytes) return false
  const bytes = new Uint8Array(await data.arrayBuffer())
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
  const actualSha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
  return actualSha256 === expectedSha256
}

async function removeAfterMetadataFailure(adminClient: BrandingClient, path: string): Promise<void> {
  const { error } = await adminClient.storage.from(BRANDING_BUCKET).remove([path])
  if (error) console.warn(JSON.stringify({ stage: 'cleanup_after_metadata_failure', result: 'error' }))
}

Deno.serve(async (request) => {
  const startedAt = Date.now()
  const requestId = crypto.randomUUID()
  let assetId: string | undefined
  let stage: Stage = 'request'
  const corsHeaders = allowedCorsHeaders(request)

  try {
    if (!isAllowedCorsOrigin(request)) throw safeError('FORBIDDEN')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (request.method !== 'POST') return responseJson({ code: 'FORBIDDEN', message: 'Método no permitido.' }, 405, corsHeaders)

    assertContentLength(request)
    const token = bearerToken(request)
    const supabaseUrl = requiredEnvironment('SUPABASE_URL')
    const anonKey = requiredEnvironment('SUPABASE_ANON_KEY')
    const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
    const userClient = createClient<BrandingDatabase>(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    stage = 'authorization'
    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData.user) throw safeError('UNAUTHORIZED')

    const formData = await request.formData()
    assetId = getAssetId(formData)
    const pendingAsset = await resolvePendingAsset(userClient, assetId)
    logEvent(requestId, assetId, stage, 'ok', startedAt)

    stage = 'validation'
    const file = getSingleUpload(formData)
    assertFileSize(file.size, pendingAsset.asset_kind)
    const input = new Uint8Array(await file.arrayBuffer())
    const detectedType = detectImageType(input)
    if (!detectedType || (file.type && file.type !== detectedType)) throw safeError('INVALID_IMAGE_TYPE')
    const headerDimensions = readHeaderDimensions(input, detectedType)
    if (!headerDimensions) throw safeError('IMAGE_DECODE_FAILED')
    assertDimensions(headerDimensions, pendingAsset.asset_kind)
    logEvent(requestId, assetId, stage, 'ok', startedAt)

    stage = 'normalization'
    const normalized = await normalizeToWebp(input, pendingAsset.asset_kind)
    logEvent(requestId, assetId, stage, 'ok', startedAt)

    const adminClient = createClient<BrandingDatabase>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    stage = 'storage'
    const { error: storageError } = await adminClient.storage.from(BRANDING_BUCKET).upload(
      pendingAsset.storage_path,
      normalized.bytes,
      { contentType: 'image/webp', upsert: false, cacheControl: '3600' },
    )
    if (storageError && !(isStorageConflict(storageError)
      && await storedObjectMatches(adminClient, pendingAsset.storage_path, normalized.sha256, BRANDING_LIMITS[pendingAsset.asset_kind].maxBytes))) {
      throw safeError('STORAGE_FAILED')
    }
    logEvent(requestId, assetId, stage, 'ok', startedAt)

    stage = 'metadata'
    const { error: metadataError } = await adminClient.rpc('record_verified_branding_asset', {
      p_asset_id: pendingAsset.asset_id,
      p_mime_type: 'image/webp',
      p_byte_size: normalized.bytes.byteLength,
      p_width: normalized.width,
      p_height: normalized.height,
      p_sha256: normalized.sha256,
    })
    if (metadataError) {
      await removeAfterMetadataFailure(adminClient, pendingAsset.storage_path)
      throw safeError('METADATA_FAILED')
    }
    logEvent(requestId, assetId, stage, 'ok', startedAt)

    stage = 'activation'
    const { error: activationError } = await userClient.rpc('activate_branding_asset', { p_asset_id: pendingAsset.asset_id })
    if (activationError) throw safeError('ACTIVATION_FAILED')
    logEvent(requestId, assetId, stage, 'ok', startedAt)

    return responseJson({ asset_id: pendingAsset.asset_id, status: 'active' }, 200, corsHeaders)
  } catch (error) {
    const handled = error instanceof BrandingAssetError ? error : safeError('INTERNAL_ERROR')
    logEvent(requestId, assetId, stage, 'error', startedAt)
    return responseJson({ code: handled.code, message: handled.message }, handled.status, corsHeaders)
  }
})
