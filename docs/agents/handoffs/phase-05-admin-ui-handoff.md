# HANDOFF — Fase 05: Panel del organizador

- Agente: Orquestador / Frontend-Admin UX
- Estado: READY

## Objetivo

Implementar el panel mobile-responsive para que owner/admin gestione quinielas, reglas, participantes y branding, manteniendo Supabase RLS y RPCs como fronteras de autorizacion.

## Estado de fases y entorno

- Fases 01 y 02: PASS.
- Fase 03: PASS en Supabase Cloud development/staging.
- Fase 04: PASS: OAuth Google, Magic Link, callback/restauracion, onboarding, join valido y repetido, codigo invalido, aislamiento cross-tenant, Pool A y logout protegido fueron validados.
- Fase 05: UI pendiente. El soporte de datos ya esta aplicado en Cloud.
- Estado general: `PHASE_04_PASS_PHASE_05_READY_ADMIN_UI`.

Operar exclusivamente contra Supabase Cloud development/staging. No usar Docker, `supabase start`, `db reset` ni stack local. No usar `service_role`, password de DB o URI de pooler en frontend.

## Archivos modificados

No hay implementacion UI de Fase 05 todavia. Las zonas previstas son:

- `apps/platform/src/router.ts` — ruta administrativa y guard de UX.
- `apps/platform/src/views/**` — dashboard, configuracion y participantes del organizador.
- `apps/platform/src/composables/**` — acceso a datos y mutaciones administrativas.
- `apps/platform/src/lib/**` — adaptador tipado de contratos RPC, si aporta separacion de UI.
- `apps/platform/src/**/*.test.ts` — pruebas de UI/composables.
- `reports/admin/phase-05-admin.md` — evidencia de fase.
- `PROJECT_STATE.md` — resultado final y gate de siguiente fase.

## Contratos/API afectados

Las siguientes migraciones ya estan aplicadas Local/Remote en Supabase Cloud:

- `20260908000100_phase_03_tenant_foundation.sql`
- `20260912000100_phase_05_admin_rpc.sql`
- `20260913000100_phase_04_join_pool_approval_status_fix.sql`

Usar los contratos server-authoritative ya aprobados:

- `rpc('approve_participant', { p_participant_id })`
- `rpc('set_participant_payment_status', { p_participant_id, p_status })`
- `rpc('publish_pool_rules', { p_pool_id, p_exact_points, p_outcome_points, p_tie_breaker, p_bonus_rules })`
- `rpc('create_pool_join_code', { p_pool_id, p_expires_at })`

No escribir directamente `participants`, `pool_rules` ni `pool_join_codes`: sus operaciones criticas deben pasar por esos RPCs. La creacion/edicion/pausa/archivo de `pools` y branding usan las grants y RLS existentes, que siguen siendo la autoridad; nunca confiar en `tenant_id` del cliente para autorizar.

## Decisiones

- Frontend: Vue 3 Composition API + Vite + Tailwind.
- `apps/platform` solo puede leer `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
- Cliente Supabase encapsulado en `apps/platform/src/lib/supabase.ts`.
- Las rutas/controles por rol solo mejoran UX; RLS y RPC toman la decision de autorizacion final.
- Mostrar limites FREE antes de acciones, sin convertir participantes o pago manual en wallet/checkout.
- No crear migrations nuevas para Fase 05 salvo que se detecte una falta real de contrato y se documente antes.

## Tests ejecutados

- Fase 04: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build` y `git diff --check`: PASS por evidencia final del usuario.
- Suite frontend actual: 15 pruebas en 6 archivos.
- Migraciones Cloud sincronizadas y `db push --linked --dry-run`: PASS sin pendientes antes del cierre de Fase 04.

## Riesgos / limitaciones

- El reporte historico `reports/data/phase-05-admin-rpc-support.md` menciona Docker/local; considerarlo antecedente, no flujo vigente.
- El fixture de aprobacion pendiente no tiene evidencia E2E Cloud de Fase 04; para Fase 05 usar datos staging documentados al probar aprobacion.
- El ZIP padre del proyecto contenia un `.env.local` administrativo segun reportes previos; no distribuirlo ni versionarlo.
- No comenzar Fase 06 hasta cerrar Fase 05 con tests, Cloud E2E administrativo, reporte y `PROJECT_STATE.md` actualizado.

## Bloqueos

No hay bloqueo activo de infraestructura, migraciones ni Auth para iniciar Fase 05.

## Próximo paso permitido

Leer, antes de editar:

1. `AGENTS.md`
2. `PROJECT_CONFIG.md`
3. `PROJECT_STATE.md`
4. `prompts/roles/frontend-ux.md`
5. `prompts/mvp/phase-05-admin.md`
6. `reports/data/phase-05-admin-rpc-support.md`

Después implementar el panel administrativo y probar como owner/admin y member, incluyendo errores backend, estados vacios, limites FREE/PRO y rutas forzadas.
