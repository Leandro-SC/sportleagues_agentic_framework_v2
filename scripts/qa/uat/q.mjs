// Consulta de solo lectura (service_role) para depurar la UAT: node scripts/qa/uat/q.mjs <tabla> <columnas> [col=valor ...]
import { ensureQaIdentities } from '../lib/qa-identities.mjs'
const { svc } = await ensureQaIdentities()
const [table, cols, ...filters] = process.argv.slice(2)
let q = svc.from(table).select(cols)
for (const f of filters) { const [c, v] = f.split('='); q = v.startsWith('~') ? q.like(c, v.slice(1)) : q.eq(c, v) }
const r = await q.limit(50)
console.log(JSON.stringify(r.error ?? r.data, null, 1))
