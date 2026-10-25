#!/usr/bin/env node
// Retención de `fixture_sync_log` en QA (ADR-020 / F-03). Solo QA; NUNCA producción (usa la CLI enlazada a QA).
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/purge-fixture-sync-log.mjs                  -> EJECUCIÓN DE PRUEBA (no borra)
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/purge-fixture-sync-log.mjs --execute        -> borra por lotes hasta 0
//   Opciones: --keep-days=180 (mín. 30)  --keep-conflict-days=365 (mín. 365)  --batch=10000
// Política: se conservan 180 días; los `conflict_manual_result` (auditoría/incidentes) 365. Solo service_role puede ejecutar la función.
// Cada ejecución (también la de prueba) queda registrada en `maintenance_runs`. Las claves se leen de la CLI en memoria y no se imprimen.
import { spawnSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

if (process.env.QA_OWNER_AUTHORIZED !== 'yes') throw new Error('Requiere QA_OWNER_AUTHORIZED=yes (solo Supabase QA).')
const arg = (name, fallback) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? '').split('=')[1] ?? fallback)
const execute = process.argv.includes('--execute')
const keepDays = arg('keep-days', 180)
const keepConflictDays = arg('keep-conflict-days', 365)
const batch = arg('batch', 10000)

const REF = 'juoftaofzepxbrrxbkhx'
const out = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', REF, '-o', 'json'], { encoding: 'utf8', shell: true }).stdout
const keys = JSON.parse(out.slice(out.indexOf('[')))
const serviceKey = keys.find((k) => k.name === 'service_role' && k.type === 'legacy')?.api_key
if (!serviceKey) throw new Error('No se pudo obtener la credencial de servicio de QA.')
const svc = createClient(`https://${REF}.supabase.co`, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

const call = async (dryRun) => {
  const { data, error } = await svc.rpc('purge_fixture_sync_log', {
    p_keep: `${keepDays} days`, p_max_rows: batch, p_dry_run: dryRun, p_keep_conflicts: `${keepConflictDays} days`,
  })
  if (error) throw new Error(`purge_fixture_sync_log: ${error.code ?? ''} ${error.message}`)
  return data
}

const total = await svc.from('fixture_sync_log').select('*', { count: 'exact', head: true })
console.log(JSON.stringify({ filas_antes: total.count, politica: { keepDays, keepConflictDays, batch } }))
const dry = await call(true)
console.log(JSON.stringify({ ejecucion_de_prueba: dry }))
if (!dry.ok) process.exit(1)
if (execute) {
  let deleted = 0
  for (let i = 0; i < 100; i++) {
    const r = await call(false)
    if (!r.ok) { console.log(JSON.stringify({ error: r })); process.exit(1) }
    deleted += r.deleted
    if (r.deleted === 0) break
  }
  const after = await svc.from('fixture_sync_log').select('*', { count: 'exact', head: true })
  console.log(JSON.stringify({ borrado_total: deleted, filas_despues: after.count }))
} else {
  console.log('Solo ejecución de prueba: nada se borró. Añade --execute para borrar.')
}
const runs = await svc.from('maintenance_runs').select('task, dry_run, affected, error, ran_at').order('ran_at', { ascending: false }).limit(5)
console.log(JSON.stringify({ ultimas_ejecuciones_registradas: runs.data ?? runs.error?.message }))
