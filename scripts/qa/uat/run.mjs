#!/usr/bin/env node
// UAT MÓVIL AUTENTICADA en navegador real (Chrome headless por CDP, sin dependencias) contra la app CONSTRUIDA y Supabase QA.
//
//   Preparación (una vez; NO usar apps/platform/dist, otro proceso puede usarla):
//     npx vite build --config apps/platform/vite.config.ts --outDir <dir>/dist --emptyOutDir
//     npx vite preview --config apps/platform/vite.config.ts --outDir <dir>/dist --port 4391 --host 127.0.0.1   (en segundo plano)
//   Ejecución:
//     QA_OWNER_AUTHORIZED=yes UAT_OUT=<dir> node scripts/qa/uat/run.mjs [--only=b1,b2,...]
//   Variables: UAT_OUT (resultados y capturas; capturas con datos sintéticos, NO se versionan), UAT_BASE_URL (def. http://127.0.0.1:4391).
//
// Bloques: b1 admin (A1-A3,F1-F3,P4,FE-01/02) · b2 participante (P1-P3,T1,R1,S1,X1) · b3 sesión/caché (C1,C2,seguridad a-f)
//          b4 calidad móvil por pantalla y viewport · b5 rendimiento y PWA (W1). H1 es NOT_RUN (cabeceras de vercel.json no aplican en local).
// Solo las 5 identidades fijas qa-*@example.test (ensureQaIdentities rota contraseñas en memoria; nunca se escriben).
// No ejecutar a la vez que scripts/qa/e2e/full-lifecycle.mjs (comparten cuentas).
import { join } from 'node:path'
import { ensureQaIdentities } from '../lib/qa-identities.mjs'
import { launchChrome } from './cdp.mjs'
import { discover } from './data.mjs'
import { ensureFreshRound, ensurePoolBOpenMatch } from './prep.mjs'
import { OUT, Reporter, shot } from './lib.mjs'

if (process.env.QA_OWNER_AUTHORIZED !== 'yes') throw new Error('Requiere QA_OWNER_AUTHORIZED=yes (QA, datos sintéticos).')
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean)
const ALL = ['b1', 'b2', 'b3', 'b4', 'b5']

const { env, svc, identities } = await ensureQaIdentities()
const D = await discover({ identities, svc })
if (!D.pool || !D.poolB) throw new Error('Faltan datos en QA: ejecutar una vez node scripts/qa/e2e/full-lifecycle.mjs')
const fresh = await ensureFreshRound({ identities, svc }, D)
const bOpen = await ensurePoolBOpenMatch({ identities, svc }, D)
const rep = new Reporter(join(OUT, 'results.json'))
console.log(`Datos: pool=${D.pool.id.slice(0, 8)} (${D.pool.ticketing_mode}), poolB=${D.poolB.id.slice(0, 8)}, jornada UAT ${fresh.round.name} (creada ahora: ${fresh.created}), partido abierto en B (creado ahora: ${bOpen.created})`)

let chromeCount = 0
const ctx = {
  env, svc, identities, D, rep, fresh, bOpen,
  async launch(name, opts = {}) {
    chromeCount += 1
    return launchChrome({ userDataDir: join(OUT, `profile-${name}`), width: opts.width ?? 390, height: opts.height ?? 844, fresh: opts.fresh ?? true })
  },
  /** Captura de la pestaña activa cuando un bloque lanza una excepción (diagnóstico; no cambia el resultado). */
  async errShot(chrome, name) {
    const page = chrome?.pages?.[chrome.pages.length - 1]
    if (!page) return
    try { await shot(page, `${name}-ERROR`); console.log(`  (captura de error: ${name}-ERROR.png, ruta ${await page.url()})`) } catch { /* sin captura */ }
  },
}

for (const b of ALL) {
  if (only.length && !only.includes(b)) continue
  console.log(`\n=== Bloque ${b}`)
  try {
    const mod = await import(`./${b}.mjs`)
    await mod.run(ctx)
  } catch (e) {
    rep.fail(`${b}.EXC`, `excepción del bloque: ${e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : String(e)}`)
  }
}
console.log(`\nResultados: ${join(OUT, 'results.json')}  (navegadores lanzados: ${chromeCount})`)
process.exit(0)
