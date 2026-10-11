#!/usr/bin/env node
// Ejecutor de las suites SQL de remediación H1–H6 / ADR-015 SIN Docker (Management API vía `npx supabase db query`).
// Política: docs/operations/CLOUD-ONLY-TESTING-POLICY.md. NO ejecutar sin autorización explícita para las clases C.
//
//   node scripts/qa/remediation/run-suite.mjs plan                  → muestra los pasos (no ejecuta nada)
//   node scripts/qa/remediation/run-suite.mjs baseline-qa           → clase A sobre el proyecto ENLAZADO (QA), solo lectura
//   node scripts/qa/remediation/run-suite.mjs acl-snapshot <ref|linked> <salida.json>   → clase A
//   SCRATCH_PROJECT_REF=<ref> SCRATCH_CONFIRM=DESTRUCTIVE node scripts/qa/remediation/run-suite.mjs bootstrap|apply|test|rollback-cycle|all
//
// Salvaguardas: las clases B/C solo corren contra SCRATCH_PROJECT_REF; se rechaza si coincide con QA, con el proyecto
// enlazado (supabase/.temp/project-ref) o si falta SCRATCH_CONFIRM=DESTRUCTIVE. Sin dependencias nuevas (solo Node).
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const QA_REF = 'juoftaofzepxbrrxbkhx'
const PROPOSED = join(ROOT, 'supabase', 'proposed')
const TESTS = join(ROOT, 'supabase', 'tests', 'proposed')
const MIGRATIONS = [
  '20261012000100_hardening_h1_persistent_lock_and_schedule_integrity.sql',
  '20261012000200_hardening_h3_h6_privileges_audit_codes.sql',
  '20261012000300_incompat_admin_participant_and_pool_staff.sql',
]
const SUITES = ['10-lock-integrity.sql', '20-privileges-audit.sql', '30-admin-participant.sql']
const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

function linkedRef() {
  const p = join(ROOT, 'supabase', '.temp', 'project-ref')
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
}

function query(target, sql, label) {
  const dir = mkdtempSync(join(tmpdir(), 'sl-suite-'))
  const file = join(dir, 'q.sql')
  writeFileSync(file, sql)
  const args = ['supabase', 'db', 'query', target === 'linked' ? '--linked' : '--project-ref', ...(target === 'linked' ? [] : [target]), '-o', 'json', '-f', file]
  const res = spawnSync('npx', args, { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 })
  const out = res.stdout || ''
  const start = out.indexOf('{')
  if (res.status !== 0 || start < 0) return { ok: false, error: `${label}: ${(res.stderr || out).split('\n').filter((l) => !/npm notice|new version|recommend/i.test(l)).join(' ').slice(0, 600)}`, rows: [] }
  try {
    const parsed = JSON.parse(out.slice(start))
    return { ok: true, rows: parsed.rows ?? [] }
  } catch (e) {
    return { ok: false, error: `${label}: respuesta no JSON`, rows: [] }
  }
}

function requireScratch() {
  const ref = process.env.SCRATCH_PROJECT_REF || ''
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('SCRATCH_PROJECT_REF ausente o inválido (se esperan 20 caracteres a-z0-9).')
  if (ref === QA_REF || ref === linkedRef()) throw new Error('RECHAZADO: el proyecto indicado es QA o el enlazado. QA nunca es entorno descartable.')
  if (process.env.SCRATCH_CONFIRM !== 'DESTRUCTIVE') throw new Error('Falta SCRATCH_CONFIRM=DESTRUCTIVE (las clases B/C son destructivas).')
  return ref
}

function report(title, rows) {
  console.log(`\n== ${title}`)
  let failed = 0
  for (const r of rows) {
    const ok = r.ok === true || r.ok === 't'
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.id ?? r.check_id}  ${r.detail ?? ''}`)
  }
  console.log(`-- ${rows.length - failed}/${rows.length} PASS`)
  return failed
}

function runSql(ref, file, label, preamble = '') {
  const r = query(ref, preamble + read(file), label)
  if (!r.ok) { console.log(`ERROR  ${r.error}`); return 1 }
  return 0
}

function runBaseline(target, expectAllPass) {
  const r = query(target, read(join(TESTS, '00-readonly-baseline.sql')), 'baseline')
  if (!r.ok) { console.log(`ERROR ${r.error}`); return 1 }
  const failed = report(`Línea base (clase A) sobre ${target === 'linked' ? 'QA (solo lectura)' : target}`, r.rows)
  return expectAllPass ? failed : 0   // sobre QA la línea base debe FALLAR hasta aplicar la remediación: es informativa
}

function runSuites(ref) {
  const helpers = read(join(TESTS, '_helpers.sql'))
  let failed = 0
  for (const s of SUITES) {
    const r = query(ref, helpers + '\n' + read(join(TESTS, s)), s)
    if (!r.ok) { console.log(`ERROR  ${r.error}`); failed += 1; continue }
    failed += report(s, r.rows)
  }
  return failed
}

const cmd = process.argv[2] || 'plan'
try {
  if (cmd === 'plan') {
    console.log('Pasos (clase C salvo indicación):\n 0. baseline-qa (A, QA solo lectura)\n 1. bootstrap: supabase/migrations/*.sql + supabase/seed/phase-03-development.sql en el proyecto descartable (estado heredado, incluye conflictos)')
    console.log(' 2. baseline en descartable (debe FALLAR) → apply 1/3, 2/3, 3/3 → baseline (debe PASAR 14/14)\n 3. test: ' + SUITES.join(', '))
    console.log(' 4. suites existentes phase-03…05 (sin cambios) como regresión: ejecutar con db query contra el descartable\n 5. concurrency.mjs (sesiones reales)\n 6. rollback-cycle: down 3→2→1, comprobar estado previo, re-aplicar 1→3, baseline 14/14')
  } else if (cmd === 'baseline-qa') {
    process.exitCode = runBaseline('linked', false)
  } else if (cmd === 'acl-snapshot') {
    const target = process.argv[3] === 'linked' ? 'linked' : process.argv[3]
    const r = query(target, read(join(TESTS, '01-readonly-function-acl-snapshot.sql')), 'acl-snapshot')
    if (!r.ok) throw new Error(r.error)
    writeFileSync(resolve(process.argv[4] || 'acl-snapshot.json'), JSON.stringify(r.rows, null, 1))
    console.log(`${r.rows.length} funciones guardadas`)
  } else if (cmd === 'acl-diff') {
    const before = JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8'))
    const after = JSON.parse(readFileSync(resolve(process.argv[4]), 'utf8'))
    const idx = new Map(after.map((r) => [r.fn, r]))
    let lost = 0
    for (const b of before) {
      const a = idx.get(b.fn)
      for (const role of ['authenticated_exec', 'service_role_exec']) {
        if (b[role] && !(a && a[role])) { lost += 1; console.log(`PIERDE ${role}: ${b.fn}`) }
      }
    }
    console.log(`anon antes: ${before.filter((r) => r.anon_exec).length}, después: ${after.filter((r) => r.anon_exec).length}; funciones que pierden EXECUTE legítimo: ${lost}`)
    process.exitCode = lost ? 1 : 0
  } else {
    const ref = requireScratch()
    if (cmd === 'bootstrap' || cmd === 'all') {
      const files = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
      for (const f of files) { console.log(`migración ${f}`); process.exitCode ||= runSql(ref, join(ROOT, 'supabase', 'migrations', f), f) }
      process.exitCode ||= runSql(ref, join(ROOT, 'supabase', 'seed', 'phase-03-development.sql'), 'seed')
    }
    if (cmd === 'apply' || cmd === 'all') {
      process.exitCode ||= runBaseline(ref, false)
      for (const m of MIGRATIONS) { console.log(`aplicando ${m}`); process.exitCode ||= runSql(ref, join(PROPOSED, m), m) }
      process.exitCode ||= runBaseline(ref, true)
    }
    if (cmd === 'test' || cmd === 'all') process.exitCode ||= runSuites(ref)
    if (cmd === 'rollback-cycle' || cmd === 'all') {
      const flag = "select set_config('sl.allow_destructive_rollback', 'on', false);\n"
      for (const m of [...MIGRATIONS].reverse()) {
        const down = join(PROPOSED, 'down', m.replace('.sql', '.down.sql'))
        console.log(`rollback ${m}`); process.exitCode ||= runSql(ref, down, m + ' (down)', flag)
      }
      const r = query(ref, read(join(TESTS, '00-readonly-baseline.sql')), 'baseline tras rollback')
      const reopened = r.ok ? r.rows.filter((x) => String(x.check_id).startsWith('P09') && (x.ok === false || x.ok === 'f')).length : 0
      console.log(reopened ? 'OK: el rollback eliminó el lock persistido (estado previo restaurado)' : 'FAIL: el rollback no restauró el estado previo')
      if (!reopened) process.exitCode = 1
      for (const m of MIGRATIONS) { console.log(`re-aplicando ${m}`); process.exitCode ||= runSql(ref, join(PROPOSED, m), m) }
      process.exitCode ||= runBaseline(ref, true)
    }
    if (!['bootstrap', 'apply', 'test', 'rollback-cycle', 'all'].includes(cmd)) throw new Error(`comando desconocido: ${cmd}`)
  }
} catch (e) {
  console.error(String(e.message || e))
  process.exitCode = 2
}
