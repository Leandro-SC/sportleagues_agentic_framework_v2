import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

import { createApiFootballProvider } from '../_shared/sports/api-football.ts'
import type { SyncDeps } from '../_shared/sports/sync.ts'
import { createSportsSyncHandler } from './handler.ts'
import { createCatalogStore, type RpcClient } from './store.ts'

// ADR-016 + ADR-021 (F-05). ÚNICO punto que habla con el proveedor deportivo y SOLO para procesos backend autorizados de la plataforma:
// `x-sync-secret` = SPORTS_SYNC_SECRET (tiempo constante). Un JWT de usuario —administrador de tenant incluido— se rechaza (403) sin consultar nada.
// Acciones (POST application/json, cuerpo ≤ 2 KiB):
//   { action: 'search', query, tenant_id? }                    · catálogo; `tenant_id` opcional = atribución del consumo al cupo de ese tenant
//   { action: 'import_season', competition, year, tenant_id? }
//   { action: 'sync' }                                         · sondeo de plataforma (presupuesto global; exige auto_results encendido)
// La clave del proveedor y la service-role viven solo en secretos de la función; jamás se devuelven ni se registran. Sin clave → NOT_CONFIGURED.
// NO está desplegada ni programada (ver docs/operations/SPORTS-SYNC-OPERATIONS.md).
const PROVIDER = 'api_football'
const SYNC_RESERVE = 10

function env(name: string): string | undefined {
  return Deno.env.get(name) || undefined
}

// La configuración de la base de datos manda; esta variable solo puede RESTAR presupuesto (p_daily_cap).
function dailyLimit(): number {
  const configured = Number(env('API_FOOTBALL_DAILY_LIMIT'))
  return Number.isInteger(configured) && configured >= 20 && configured <= 100_000 ? configured : 100 // plan gratuito por defecto
}

Deno.serve(createSportsSyncHandler({
  getEnv: env,
  log: (entry) => console.log(JSON.stringify(entry)),
  async open({ kind, tenantId }) {
    const url = env('SUPABASE_URL')
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !serviceKey) throw new Error('not configured')
    const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const store = createCatalogStore(db as unknown as RpcClient, { provider: PROVIDER, kind, tenantId })
    const apiKey = env('API_FOOTBALL_KEY')
    const deps: SyncDeps = {
      store,
      dailyLimit: dailyLimit(),
      syncReserve: SYNC_RESERVE,
      provider: (gate) => createApiFootballProvider({ apiKey, gate, plan: env('API_FOOTBALL_PLAN') === 'paid' ? 'paid' : 'free' }),
    }
    return { deps, checkAccess: () => store.checkAccess(), denial: () => store.denial() }
  },
}))
