#!/usr/bin/env node
// Herramienta del OPERADOR para cuentas de QA (solo Supabase QA). No se ejecuta desde el frontend ni desde CI.
//
//   node scripts/qa/qa-accounts.mjs inventory
//       Solo lectura. Imprime AGREGADOS (conteos por categoría); no imprime correos, UUIDs ni tokens.
//   node scripts/qa/qa-accounts.mjs invite <correo>            (simulación: dice qué haría)
//   node scripts/qa/qa-accounts.mjs invite <correo> --execute  (envía la invitación OFICIAL de Supabase Auth)
//
// Entorno requerido (en TU terminal; nunca en el repo):
//   SUPABASE_URL                 URL del proyecto QA
//   SUPABASE_SERVICE_ROLE_KEY    clave de servicio de QA (secreto; no se imprime)
//   QA_SITE_URL                  opcional; por defecto https://sportleagues-qa.vercel.app
//
// Reglas (Encargo Maestro §8): la invitación no fija contraseña y no omite la verificación del correo; no se crea
// duplicado si la cuenta ya existe; la cuenta invitada queda solo como `user` (esta herramienta NO crea membresías
// administrativas). El acceso a ligas QA lo obtiene el propio usuario con un código de invitación (`join_pool`),
// nunca por DML directo. Esta herramienta no borra nada: la limpieza de cuentas requiere la lista exacta aprobada.
import { createClient } from '@supabase/supabase-js'

const [command, emailArg, ...flags] = process.argv.slice(2)
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en tu entorno (no se imprimen).')
  process.exit(2)
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

function category(email = '') {
  const e = email.toLowerCase()
  if (e.endsWith('@example.test')) return 'synthetic_example_test'
  if (e.endsWith('@gmail.com')) return 'gmail_real_or_validation'
  return 'other'
}

async function listAllUsers() {
  const users = []
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 200) break
  }
  return users
}

async function count(table) {
  const { count: n, error } = await admin.from(table).select('*', { count: 'exact', head: true })
  return error ? `error:${error.code ?? 'unknown'}` : n
}

async function inventory() {
  const users = await listAllUsers()
  const byCategory = {}
  for (const u of users) {
    const c = category(u.email)
    byCategory[c] = (byCategory[c] ?? 0) + 1
  }
  const confirmed = users.filter((u) => u.email_confirmed_at).length
  const withSignIn = users.filter((u) => u.last_sign_in_at).length
  console.log(JSON.stringify({
    auth_users_total: users.length,
    by_category: byCategory,
    email_confirmed: confirmed,
    with_sign_in: withSignIn,
    rows: {
      profiles: await count('profiles'),
      tenants: await count('tenants'),
      participants: await count('participants'),
      tickets: await count('tickets'),
      predictions: await count('predictions'),
      audit_log: await count('audit_log'),
    },
    note: 'Solo agregados. Las cuentas sintéticas no se borran por diseño (tablas append-only/inmutables, ver QA-SYNTHETIC-RESIDUE.md).',
  }, null, 2))
}

async function invite(email, execute) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Indica un correo válido.')
    process.exit(2)
  }
  const users = await listAllUsers()
  const existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (existing) {
    console.log(JSON.stringify({
      action: 'none', reason: 'account_already_exists', confirmed: Boolean(existing.email_confirmed_at),
      next: 'No se duplica. Si no ha entrado, que use «¿Olvidaste tu contraseña?» o inicie con Google; luego que se una a las ligas QA autorizadas con su código.',
    }, null, 2))
    return
  }
  if (!execute) {
    console.log(JSON.stringify({ action: 'dry_run', would: 'inviteUserByEmail', note: 'Añade --execute para enviar la invitación oficial.' }, null, 2))
    return
  }
  const site = (process.env.QA_SITE_URL || 'https://sportleagues-qa.vercel.app').replace(/\/$/, '')
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/callback` })
  if (error) { console.error(`invite: ${error.message}`); process.exit(1) }
  console.log(JSON.stringify({
    action: 'invited', status: 'pending_acceptance',
    next: 'Queda pendiente de que la persona acepte el correo. Después debe usar el código de unión de cada liga QA autorizada (join_pool); no se asigna ningún rol administrativo.',
  }, null, 2))
}

try {
  if (command === 'inventory') await inventory()
  else if (command === 'invite') await invite(emailArg, flags.includes('--execute'))
  else { console.error('Uso: inventory | invite <correo> [--execute]'); process.exit(2) }
} catch (e) {
  console.error(e instanceof Error ? e.message : 'error desconocido')
  process.exit(1)
}
