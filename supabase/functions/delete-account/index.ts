// Eliminación de la propia cuenta (ADR-026). Orden: origen → método → JWT verificado → confirmación → anonimización en SQL
// (`anonymize_account`, solo service_role) → borrado suave de la identidad de Auth (email/teléfono anonimizados, sesiones revocadas).
// Sin PII en los registros: solo el id de la petición, la etapa y el resultado.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import { bearerToken, corsHeaders, mapAnonymizeError, STATUS, validConfirmation, type DeletionCode } from './_core.ts'

function reply(code: DeletionCode, headers: Record<string, string>, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ code, ...extra }), { status: STATUS[code], headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })
}

Deno.serve(async (request) => {
  const requestId = crypto.randomUUID()
  const origin = request.headers.get('origin')
  const cors = corsHeaders(origin, Deno.env.get('CORS_ALLOWED_ORIGINS'))
  const log = (stage: string, result: string) => console.log(JSON.stringify({ request_id: requestId, stage, result }))
  if (origin && !Object.keys(cors).length) return reply('FORBIDDEN', {})
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return reply('METHOD_NOT_ALLOWED', cors)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) { log('config', 'error'); return reply('INTERNAL_ERROR', cors) }

  const token = bearerToken(request.headers.get('authorization'))
  if (!token) return reply('UNAUTHORIZED', cors)
  const userClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userError } = await userClient.auth.getUser(token)
  if (userError || !userData.user) { log('auth', 'unauthorized'); return reply('UNAUTHORIZED', cors) }

  if (!validConfirmation(await request.text())) return reply('CONFIRMATION_REQUIRED', cors)

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: anonymizeError } = await admin.rpc('anonymize_account', { p_profile: userData.user.id })
  const mapped = mapAnonymizeError(anonymizeError)
  if (mapped) { log('anonymize', mapped.code); return reply(mapped.code, cors, mapped.blockers ? { blockers: mapped.blockers } : {}) }

  const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id, true)
  if (deleteError) { log('auth_delete', 'error'); return reply('INTERNAL_ERROR', cors) }
  log('done', 'ok')
  return reply('DELETED', cors)
})
