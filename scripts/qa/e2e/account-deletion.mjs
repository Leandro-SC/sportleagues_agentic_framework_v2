#!/usr/bin/env node
// E2E real de la eliminación de cuenta (ADR-026) contra Supabase QA y la Edge Function desplegada `delete-account`.
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/e2e/account-deletion.mjs
// Crea UNA cuenta desechable por ejecución (qa-delete-<marca>@example.test) y la elimina con el flujo real. No usa las 5 identidades
// fijas (no rota sus contraseñas). Residuo: el usuario de Auth queda borrado en modo suave (correo anonimizado) y su perfil como
// «Usuario eliminado»; registrado en docs/operations/QA-SYNTHETIC-RESIDUE.md. Nada se imprime salvo resultados.
import { randomBytes } from 'node:crypto'
import { loadQaEnv } from '../lib/qa-identities.mjs'

const env = loadQaEnv()
const svc = env.serviceClient()
const results = []
const rec = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${detail}`) }
const status = (r) => r.error?.context?.status ?? (r.error ? 'error' : 200)
const code = async (r) => { try { return (await r.error?.context?.json?.())?.code ?? r.data?.code } catch { return r.data?.code } }

const email = `qa-delete-${Date.now()}@example.test`
const password = `Qa-${randomBytes(24).toString('base64url')}-9aZ`
const created = await svc.auth.admin.createUser({ email, password, email_confirm: true })
if (created.error) throw new Error(`createUser: ${created.error.message}`)
const id = created.data.user.id
const prof = await svc.from('profiles').insert({ id, display_name: 'qa-delete' })
if (prof.error) throw new Error(`profile: ${prof.error.message}`)

const anon = env.anonClient()
const noUser = await anon.functions.invoke('delete-account', { body: { confirm: 'ELIMINAR' } })
rec('AD.1', status(noUser) === 401, `sin sesión de usuario: HTTP ${status(noUser)} (${await code(noUser)})`)

const user = env.anonClient()
const login = await user.auth.signInWithPassword({ email, password })
rec('AD.2', !login.error, 'la cuenta desechable inicia sesión')

const bad = await user.functions.invoke('delete-account', { body: { confirm: 'si' } })
rec('AD.3', status(bad) === 400, `confirmación incorrecta: HTTP ${status(bad)} (${await code(bad)})`)
const other = await user.functions.invoke('delete-account', { body: { confirm: 'ELIMINAR', user_id: '00000000-0000-0000-0000-000000000000' } })
rec('AD.4', status(other) === 400, `no acepta elegir otro usuario en el cuerpo: HTTP ${status(other)}`)

const blockers = await user.rpc('account_deletion_blockers')
rec('AD.5', !blockers.error && Array.isArray(blockers.data) && blockers.data.length === 0, `sin impedimentos: ${JSON.stringify(blockers.data)}`)

const ok = await user.functions.invoke('delete-account', { body: { confirm: 'ELIMINAR' } })
rec('AD.6', status(ok) === 200 && ok.data?.code === 'DELETED', `eliminación: HTTP ${status(ok)} (${ok.data?.code ?? await code(ok)})`)

const after = await svc.from('profiles').select('display_name, deleted_at').eq('id', id).single()
rec('AD.7', after.data?.display_name === 'Usuario eliminado' && Boolean(after.data?.deleted_at), `perfil anonimizado: ${after.data?.display_name}, baja=${after.data?.deleted_at ? 'sí' : 'no'}`)

const relogin = await env.anonClient().auth.signInWithPassword({ email, password })
rec('AD.8', Boolean(relogin.error), `ya no puede iniciar sesión (${relogin.error?.code ?? relogin.error?.message ?? 'sin error'})`)

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} PASS`)
process.exit(failed ? 1 : 0)
