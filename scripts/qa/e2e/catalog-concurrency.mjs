#!/usr/bin/env node
// Concurrencia REAL contra QA: N sesiones simultáneas solicitan la MISMA importación (catalog_begin_import). Debe haber exactamente
// UNA 'started'; el resto 'in_progress' (sin consumir cuota) y, después, 'fresh'. Cada sesión mantiene el bloqueo con pg_sleep dentro
// de la misma sentencia para forzar el solapamiento. Deja un único registro sintético en catalog_import_jobs que este script elimina.
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/e2e/catalog-concurrency.mjs
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.env.QA_OWNER_AUTHORIZED !== 'yes') throw new Error('Requiere QA_OWNER_AUTHORIZED=yes (QA, datos sintéticos).')
const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const N = 6
const resource = `conc-test:${randomUUID().slice(0, 8)}`
const dir = mkdtempSync(join(tmpdir(), 'sl-conc-'))

const sqlFor = (extra = '') => `select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select outcome${extra} from public.catalog_begin_import('api_football', '${resource}', null, interval '1 hour', interval '5 minutes');`
const run = (sql, name) => new Promise((resolveRun) => {
  const file = join(dir, `${name}.sql`)
  writeFileSync(file, sql)
  const child = spawn('npx', ['supabase', 'db', 'query', '--linked', '-o', 'json', '-f', file], { cwd: ROOT, shell: true })
  let out = ''
  child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
  child.on('close', () => resolveRun(out))
})
const outcomeOf = (out) => (out.match(/"outcome":\s*"(\w+)"/) ?? [])[1]

const results = []
const rec = (id, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? '  ' + detail : ''}`) }

const outs = await Promise.all(Array.from({ length: N }, (_, i) => run(sqlFor(', pg_sleep(4)'), `s${i}`)))
const outcomes = outs.map(outcomeOf)
const started = outcomes.filter((o) => o === 'started').length
rec('CONC1 con 6 solicitudes simultáneas hay exactamente UNA importación iniciada', started === 1, JSON.stringify(outcomes))
rec('CONC2 el resto recibe in_progress (sin trabajo duplicado)', outcomes.filter((o) => o === 'in_progress').length === N - 1, JSON.stringify(outcomes))
const after = outcomeOf(await run(sqlFor(), 'after'))
rec('CONC3 mientras el trabajo sigue en curso (no terminado) una nueva solicitud sigue en in_progress', after === 'in_progress', after)

// Cierra el trabajo y comprueba la ventana de frescura; luego limpia el residuo sintético.
const finish = await run(`select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.catalog_finish_import(id, 'succeeded', null, 1) from public.catalog_import_jobs where provider = 'api_football' and resource_key = '${resource}' and status = 'running';`, 'finish')
const fresh = outcomeOf(await run(sqlFor(), 'fresh'))
rec('CONC4 terminada la importación una solicitud posterior es fresh (no se repite)', fresh === 'fresh', fresh)
const cleanupFile = join(dir, 'cleanup.sql')
writeFileSync(cleanupFile, `delete from public.catalog_import_jobs where resource_key = '${resource}' returning 1 as removed;`)
const cleanup = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '-o', 'json', '-f', cleanupFile], { cwd: ROOT, shell: true, encoding: 'utf8' })
rec('CONC5 residuo sintético eliminado', /"removed":\s*1/.test(cleanup.stdout + cleanup.stderr), '')
void finish
const failed = results.filter((ok) => !ok).length
console.log(`${results.length - failed}/${results.length} PASS`)
process.exitCode = failed ? 1 : 0
