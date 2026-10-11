#!/usr/bin/env node
// Ejecuta suites SQL con helpers (supabase/tests/proposed/_helpers.sql) contra el proyecto ENLAZADO (QA) SIN dejar datos:
// todo corre dentro de una transacción que termina en excepción controlada (rollback) y los resultados viajan en el mensaje.
// Sin Docker; usa `supabase db query --linked`. Uso:
//   node scripts/qa/run-sql-suite.mjs <suite.sql> [...] [--with-migration <archivo.sql>]   (la migración se prueba DENTRO de la transacción)
// Una suite que necesite persistir datos (p. ej. concurrencia con sesiones reales) no usa este ejecutor y debe documentar su residuo
// en docs/operations/QA-SYNTHETIC-RESIDUE.md.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
const argv = process.argv.slice(2)
const migrations = []
const suites = []
for (let i = 0; i < argv.length; i++) { if (argv[i] === '--with-migration') migrations.push(argv[++i]); else suites.push(argv[i]) }
if (!suites.length) { console.error('Indica al menos una suite.'); process.exit(2) }

const MARK = 'SLRESULTS:'
const tail = `
do $slr$ declare j jsonb; begin
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'ok', ok, 'detail', detail) order by id), '[]') into j from t_results;
  raise exception '${MARK}%', j::text using errcode = 'P0001';
end $slr$;`

let failed = 0
for (const s of suites) {
  // Los códigos de invitación fijos de las suites (ZZnnXX) se sustituyen por aleatorios: las suites siguen siendo repetibles.
  const codes = new Map()
  const rnd = () => 'Q' + Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
  const suiteSql = read(s).replace(/ZZ[0-9]{2}[A-Z0-9]{2}/g, (c) => { if (!codes.has(c)) codes.set(c, rnd()); return codes.get(c) })
  const sql = ['begin;', ...migrations.map(read), read('supabase/tests/proposed/_helpers.sql'), suiteSql, tail].join('\n')
  const f = join(mkdtempSync(join(tmpdir(), 'sl-suite-')), 'q.sql')
  writeFileSync(f, sql)
  const r = spawnSync('npx', ['supabase', 'db', 'query', '--linked', '-o', 'json', '-f', f], { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 1 << 26 })
  const out = (r.stdout || '') + (r.stderr || '')
  const j = out.slice(out.indexOf('{"message"'))
  let msg = ''
  try { msg = JSON.parse(j.slice(0, j.lastIndexOf('}') + 1)).message || '' } catch { /* sin JSON de error */ }
  const at = msg.indexOf(MARK)
  if (at < 0) { console.log(`ERROR ${s}: ${(msg || out).slice(0, 800)}`); failed++; continue }
  const body = msg.slice(at + MARK.length)
  const rows = JSON.parse(body.slice(0, body.lastIndexOf(']') + 1))
  let bad = 0
  for (const x of rows) if (!x.ok) { bad++; console.log(`FAIL ${x.id} ${String(x.detail).slice(0, 300)}`) }
  console.log(`== ${s}: ${rows.length - bad}/${rows.length} PASS (rollback: sin datos persistidos)`)
  failed += bad + (rows.length ? 0 : 1)
}
process.exitCode = failed ? 1 : 0
