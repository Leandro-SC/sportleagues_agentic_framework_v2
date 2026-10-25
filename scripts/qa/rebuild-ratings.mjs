#!/usr/bin/env node
// Operador: reconstruye los ratings Elo (ADR-019) desde todos los resultados oficiales vigentes. Determinista e idempotente: repetirlo
// con los mismos resultados produce la misma huella. Solo service_role (vía CLI enlazada); nada se imprime salvo el resumen.
//   QA_OWNER_AUTHORIZED=yes node scripts/qa/rebuild-ratings.mjs [--tenant <uuid>]
import { loadQaEnv } from './lib/qa-identities.mjs'

const tenantArg = process.argv.indexOf('--tenant')
const tenant = tenantArg > 0 ? process.argv[tenantArg + 1] : null
if (tenant && !/^[0-9a-f-]{36}$/i.test(tenant)) throw new Error('--tenant debe ser un uuid')

const svc = loadQaEnv().serviceClient()
const { data, error } = await svc.rpc('rebuild_team_ratings', { p_sport_code: 'football', p_tenant_id: tenant, p_model_version: null })
if (error) { console.error(`rebuild_team_ratings: ${error.code ?? ''} ${error.message}`); process.exit(1) }
console.log(JSON.stringify({ tenants: data?.tenants, matches_processed: data?.matches_processed, teams_rated: data?.teams_rated, model_version: data?.model_version }))
