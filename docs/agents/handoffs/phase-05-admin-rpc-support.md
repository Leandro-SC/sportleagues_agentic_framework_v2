# HANDOFF — Fase 05 (soporte de datos): RPCs de administración

- Agente: Data/RLS Agent
- Estado: PARTIAL (este sub-entregable: DONE; la Fase 05 completa sigue abierta)

## Objetivo

Cerrar el gap detectado entre el prompt de Fase 05 (aprobar participantes, gestionar pago, versionar reglas, generar códigos de unión) y la superficie de escritura que Fase 03 dejó disponible en el esquema.

## Archivos modificados

- `supabase/migrations/20260912000100_phase_05_admin_rpc.sql` (nuevo)
- `supabase/seed/phase-03-development.sql` (fixture adicional para probar aprobación)
- `supabase/tests/phase-05-admin-rpc.sql` (nuevo)
- `reports/data/phase-05-admin-rpc-support.md`
- `PROJECT_STATE.md`

## Contratos/API afectados

Nuevos RPC: `approve_participant`, `set_participant_payment_status`, `publish_pool_rules`, `create_pool_join_code`. Se revoca `insert/update/delete` directo en `pool_rules` y `insert` en `pool_join_codes` para `authenticated`. `participants` ya estaba revocado desde Fase 03 y sigue así (ahora con RPC de aprobación/pago).

## Decisiones

Ver `reports/data/phase-05-admin-rpc-support.md`.

## Tests ejecutados

`npx supabase db reset` + `supabase/tests/phase-03-rls.sql` + `supabase/tests/phase-05-admin-rpc.sql` contra Postgres local real (Docker): todo PASS. Detalle en el reporte.

## Riesgos / limitaciones

Solo contrato de datos; no incluye UI. No se probó contra Supabase Cloud.

## Bloqueos

Ninguno para este sub-entregable. La Fase 05 completa sigue bloqueada por: (a) UI/composables del panel admin sin construir, (b) Fase 04 aún `PARTIAL` por E2E cloud pendiente.

## Próximo paso permitido

Agente Frontend/Admin UX: construir el panel de Fase 05 (dashboard de quinielas, reglas, participantes, branding) usando estos RPC + los grants directos de Fase 03. No declarar la Fase 05 cerrada hasta que Fase 04 tenga su E2E cloud.
