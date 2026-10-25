// Identidades sintéticas FIJAS y PERSISTENTES para las pruebas contra Supabase QA (proyecto juoftaofzepxbrrxbkhx). Solo QA.
//
// Por qué existe: las cuentas de Auth sintéticas no se pueden borrar (tablas append-only, ver docs/operations/QA-SYNTHETIC-RESIDUE.md).
// En lugar de crear 5 cuentas nuevas por ejecución, TODAS las pruebas (E2E de API y UAT de navegador) reutilizan estas 5 y no
// se debe crear ninguna otra:
//
//   requester  qa-requester@example.test   pide ser organizador (solicitud «Crear mi propia quiniela»)
//   adminB     qa-admin-b@example.test     segundo organizador (aislamiento entre tenants)
//   user1      qa-user1@example.test       participante
//   user2      qa-user2@example.test       participante (también prueba el rechazo/cooldown de la solicitud)
//   outsider   qa-outsider@example.test    sin tenant ni participaciones (usuario ajeno)
//
// API (todo en memoria; nada se imprime ni se guarda; las claves de la CLI se leen con `npx supabase projects api-keys`):
//
//   import { ensureQaIdentities, loadQaEnv, QA_IDENTITY_EMAILS } from './lib/qa-identities.mjs'   // ruta relativa a quien importa
//
//   const { env, svc, identities } = await ensureQaIdentities()
//     env.url                  URL del proyecto QA
//     env.serviceClient()      cliente service_role NUEVO (solo operador/verificación; nunca en frontend)
//     env.anonClient()         cliente anon NUEVO (sin sesión)
//     svc                      el mismo cliente service_role ya creado
//     identities.<clave>       { key, email, id, client, signIn() }
//        .client               cliente supabase-js con sesión de usuario (misma frontera RLS/RPC que la app)
//        .id                   uuid del perfil
//        .password             contraseña de ESTA ejecución, solo en memoria; propiedad NO enumerable (no sale en console.log,
//                              JSON.stringify ni spread). El UAT de navegador la usa para iniciar sesión y NO debe escribirla en
//                              ningún archivo, captura ni log.
//        .signIn()             devuelve un cliente nuevo con una sesión nueva (útil para probar concurrencia o sesiones separadas)
//
// Qué hace `ensureQaIdentities()` (idempotente):
//   1. Localiza cada cuenta por su perfil (`profiles.display_name` = `qa-<clave>`) y VERIFICA con `auth.admin.getUserById` que el correo
//      coincide exactamente; nunca lista `auth.users` ni lee datos de otras personas.
//   2. Si no existe, la crea (correo confirmado) y crea su `profiles`. Si el correo ya existía pero no se encuentra su perfil (corte entre
//      los dos pasos de una ejecución anterior) lanza un error explícito en lugar de enumerar usuarios.
//   3. En CADA ejecución FIJA una contraseña aleatoria nueva con la API admin (`auth.admin.updateUserById`), así que NO hay contraseñas
//      reutilizables ni guardadas. Consecuencia: dos agentes no deben usar el módulo a la vez (el último en ejecutarse invalida la
//      contraseña del otro; las sesiones ya abiertas siguen valiendo hasta que caduque su JWT).
//   4. Inicia sesión con cada una y devuelve los clientes autenticados.
//
// Requiere QA_OWNER_AUTHORIZED=yes (lo exige también cada script que lo importa).
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const QA_PROJECT_REF = 'juoftaofzepxbrrxbkhx'

export const QA_IDENTITY_EMAILS = Object.freeze({
  requester: 'qa-requester@example.test',
  adminB: 'qa-admin-b@example.test',
  user1: 'qa-user1@example.test',
  user2: 'qa-user2@example.test',
  outsider: 'qa-outsider@example.test',
})

const DISPLAY_NAMES = Object.freeze({
  requester: 'qa-requester', adminB: 'qa-admin-b', user1: 'qa-user1', user2: 'qa-user2', outsider: 'qa-outsider',
})

const AUTH_OPTS = { auth: { persistSession: false, autoRefreshToken: false } }
let cachedEnv = null

export function loadQaEnv() {
  if (process.env.QA_OWNER_AUTHORIZED !== 'yes') throw new Error('Requiere QA_OWNER_AUTHORIZED=yes (QA, datos sintéticos).')
  if (cachedEnv) return cachedEnv
  const url = `https://${QA_PROJECT_REF}.supabase.co`
  const out = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', QA_PROJECT_REF, '-o', 'json'], { encoding: 'utf8', shell: true }).stdout ?? ''
  const start = out.indexOf('[')
  if (start < 0) throw new Error('No se pudieron leer las credenciales de QA desde la CLI (¿sesión de supabase iniciada y proyecto enlazado?).')
  const keys = JSON.parse(out.slice(start))
  const key = (name) => keys.find((k) => k.name === name && k.type === 'legacy')?.api_key
  const serviceKey = key('service_role')
  const anonKey = key('anon')
  if (!serviceKey || !anonKey) throw new Error('Faltan credenciales anon/service_role de QA.')
  cachedEnv = Object.freeze({
    url,
    ref: QA_PROJECT_REF,
    serviceClient: () => createClient(url, serviceKey, AUTH_OPTS),
    anonClient: () => createClient(url, anonKey, AUTH_OPTS),
  })
  return cachedEnv
}

const newPassword = () => `Qa-${randomBytes(24).toString('base64url')}-9aZ`

async function findUserIdByProfile(svc, key) {
  const { data, error } = await svc.from('profiles').select('id').eq('display_name', DISPLAY_NAMES[key])
  if (error) throw new Error(`profiles(${key}): ${error.message}`)
  for (const row of data ?? []) {
    const { data: u, error: ue } = await svc.auth.admin.getUserById(row.id)
    if (!ue && u?.user?.email?.toLowerCase() === QA_IDENTITY_EMAILS[key]) return row.id
  }
  return null
}

async function ensureOne(env, svc, key) {
  const email = QA_IDENTITY_EMAILS[key]
  let id = await findUserIdByProfile(svc, key)
  const password = newPassword()
  if (!id) {
    const created = await svc.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error) {
      throw new Error(`createUser(${key}): ${created.error.code ?? created.error.message}. Si la cuenta ya existía sin perfil (corte previo), repárala a mano: este módulo no enumera auth.users.`)
    }
    id = created.data.user.id
    const prof = await svc.from('profiles').upsert({ id, display_name: DISPLAY_NAMES[key] }, { onConflict: 'id' })
    if (prof.error) throw new Error(`profiles upsert(${key}): ${prof.error.message}`)
  } else {
    // Cuenta existente: contraseña nueva en cada ejecución (en memoria); se asegura también que siga confirmada.
    const upd = await svc.auth.admin.updateUserById(id, { password, email_confirm: true })
    if (upd.error) throw new Error(`updateUserById(${key}): ${upd.error.message}`)
    const prof = await svc.from('profiles').upsert({ id, display_name: DISPLAY_NAMES[key] }, { onConflict: 'id' })
    if (prof.error) throw new Error(`profiles upsert(${key}): ${prof.error.message}`)
  }
  const signIn = async () => {
    const c = env.anonClient()
    const r = await c.auth.signInWithPassword({ email, password })
    if (r.error) throw new Error(`signIn(${key}): ${r.error.message}`)
    return c
  }
  const client = await signIn()
  const identity = { key, email, id, client, signIn }
  Object.defineProperty(identity, 'password', { value: password, enumerable: false, writable: false })
  return identity
}

export async function ensureQaIdentities() {
  const env = loadQaEnv()
  const svc = env.serviceClient()
  const identities = {}
  for (const key of Object.keys(QA_IDENTITY_EMAILS)) identities[key] = await ensureOne(env, svc, key)
  return { env, svc, identities }
}
