#!/usr/bin/env node
// Herramienta del OPERADOR para evaluar solicitudes «Crear mi propia quiniela» (ADR-017). Solo QA; la app pública NO puede aprobar.
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/review-pool-request.mjs list
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/review-pool-request.mjs approve <request_id> [--name="Nombre del tenant"]
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/review-pool-request.mjs reject  <request_id> [--note="motivo"]
// `list` muestra solo id, estado y fechas (sin correos ni nombres). Aprobar crea el tenant gratuito y la membresía `owner` en una
// transacción idempotente (RPC `review_pool_creation_request`, ejecutable solo por service_role). La clave se lee de la CLI en memoria.
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

if (process.env.QA_OWNER_AUTHORIZED !== 'yes') throw new Error('Requiere QA_OWNER_AUTHORIZED=yes (solo Supabase QA).')
const [command, requestId, ...rest] = process.argv.slice(2)
const opt = (name) => (rest.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=').slice(1).join('=') || null

const REF = 'juoftaofzepxbrrxbkhx'
const out = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', REF, '-o', 'json'], { encoding: 'utf8', shell: true }).stdout
const keys = JSON.parse(out.slice(out.indexOf('[')))
const serviceKey = keys.find((k) => k.name === 'service_role' && k.type === 'legacy')?.api_key
if (!serviceKey) throw new Error('No se pudo obtener la credencial de servicio de QA.')
const svc = createClient(`https://${REF}.supabase.co`, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

if (command === 'list') {
  const { data, error } = await svc.from('pool_creation_requests').select('id, status, requested_at, reviewed_at, tenant_id').order('requested_at', { ascending: false }).limit(50)
  if (error) throw new Error(error.message)
  console.log(JSON.stringify(data, null, 1))
} else if (command === 'approve' || command === 'reject') {
  if (!/^[0-9a-f-]{36}$/i.test(requestId ?? '')) throw new Error('Indica un request_id válido.')
  const { data, error } = await svc.rpc('review_pool_creation_request', {
    p_request_id: requestId, p_decision: command, p_note: opt('note'), p_tenant_name: command === 'approve' ? opt('name') : null,
  })
  if (error) throw new Error(`${error.code ?? ''} ${error.message}`)
  console.log(JSON.stringify({ status: data.status, created: data.created, tenant_creado: Boolean(data.tenant_id) }))
} else {
  console.error('Uso: list | approve <id> [--name=] | reject <id> [--note=]')
  process.exit(2)
}
