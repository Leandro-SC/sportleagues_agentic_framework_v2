// Sondeo de SOLO LECTURA de la configuración de Auth en QA. No crea usuarios, no envía correos y
// no imprime claves. Uso (Git Bash):
//   node --env-file=apps/platform/.env.local scripts/qa/auth-config-probe.mjs
// Variables: VITE_SUPABASE_URL (o SUPABASE_URL) y VITE_SUPABASE_ANON_KEY (o SUPABASE_ANON_KEY).
// Opcional: QA_ORIGIN (por defecto https://sportleagues-qa.vercel.app).
const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')
const key = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
const origin = (process.env.QA_ORIGIN ?? 'https://sportleagues-qa.vercel.app').replace(/\/$/, '')
if (!url || !key) { console.error('BLOCKED: faltan SUPABASE_URL / SUPABASE_ANON_KEY'); process.exit(2) }

const results = []
const record = (id, status, detail) => { results.push({ id, status, detail }); console.log(`${status.padEnd(7)} ${id} — ${detail}`) }
const headers = { apikey: key }

async function settings() {
  const res = await fetch(`${url}/auth/v1/settings`, { headers })
  if (!res.ok) { record('S1 settings', 'FAIL', `HTTP ${res.status}`); return }
  const s = await res.json()
  record('S1 proveedor Email', s.external?.email ? 'PASS' : 'FAIL', `email=${s.external?.email}`)
  record('S2 proveedor Google', s.external?.google ? 'PASS' : 'FAIL', `google=${s.external?.google}`)
  record('S3 confirmación de correo', s.mailer_autoconfirm === false ? 'PASS' : 'FAIL', `mailer_autoconfirm=${s.mailer_autoconfirm}`)
  record('S4 registro abierto', s.disable_signup === false ? 'INFO' : 'INFO', `disable_signup=${s.disable_signup}`)
  record('S5 sin otros proveedores', Object.entries(s.external ?? {}).filter(([k, v]) => v && !['email', 'google'].includes(k)).length === 0 ? 'PASS' : 'FAIL', 'solo email y google habilitados')
}

function stateReferrer(location) {
  const state = new URL(location).searchParams.get('state')
  if (!state) return null
  try { return JSON.parse(Buffer.from(state.split('.')[1], 'base64url').toString('utf8')).referrer ?? null } catch { return null }
}

async function google() {
  const probe = async (redirectTo) => {
    const res = await fetch(`${url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`, { headers, redirect: 'manual' })
    return { status: res.status, location: res.headers.get('location') }
  }
  const ok = await probe(`${origin}/auth/callback`)
  if (!ok.location) { record('G1 Google authorize', 'FAIL', `HTTP ${ok.status} sin redirección`); return }
  const target = new URL(ok.location)
  record('G1 Google redirige a accounts.google.com', target.host === 'accounts.google.com' ? 'PASS' : 'FAIL', `host=${target.host}`)
  record('G2 client_id de Google configurado', (target.searchParams.get('client_id') ?? '').length > 10 ? 'PASS' : 'FAIL', 'client_id presente (valor no impreso)')
  record('G3 redirect_uri de Supabase', target.searchParams.get('redirect_uri') === `${url}/auth/v1/callback` ? 'PASS' : 'FAIL', 'coincide con <ref>.supabase.co/auth/v1/callback (debe estar registrado en Google Cloud)')
  // La lista de Redirect URLs NO es observable con la anon key: `state` es opaco y GoTrue sustituye
  // en silencio un destino no permitido por el Site URL. Se revisa en el Dashboard (ver runbook).
  record('R1 Redirect URLs / Site URL', 'BLOCKED', 'requiere Dashboard: Authentication → URL Configuration (ver docs/operations/AUTH-QA-CONFIGURATION.md)')
}

async function login() {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ email: `auth-probe-${Date.now()}@example.invalid`, password: 'Incorrecta123' }),
  })
  const body = await res.json().catch(() => ({}))
  record('L1 login inválido = invalid_credentials genérico', res.status === 400 && body.error_code === 'invalid_credentials' ? 'PASS' : 'FAIL', `HTTP ${res.status} code=${body.error_code}`)
}

await settings(); await google(); await login()
const failed = results.filter((r) => r.status === 'FAIL').length
console.log(`\nResumen: ${results.filter((r) => r.status === 'PASS').length} PASS, ${failed} FAIL, ${results.filter((r) => r.status === 'BLOCKED').length} BLOCKED, ${results.filter((r) => r.status === 'INFO').length} INFO`)
process.exit(failed ? 1 : 0)
