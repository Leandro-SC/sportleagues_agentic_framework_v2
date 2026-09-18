# Fase 03 - Modelo de datos, multi-tenancy y RLS

## Resultado

`PHASE_03_PASS / SUPABASE_CLOUD_VALIDATED` - migracion, seed y suite RLS fueron validados contra el proyecto remoto de desarrollo/staging en Supabase Cloud. El incidente historico de Realtime local no forma parte del criterio final.

## Artefactos

- `supabase/migrations/20260908000100_phase_03_tenant_foundation.sql`: migracion forward-only para una DB Supabase vacia.
- `supabase/seed/phase-03-development.sql`: seed reproducible con dos tenants, owner/admin/member, outsider, pools, torneo, equipos, jornada, partidos y predicciones.
- `supabase/tests/phase-03-rls.sql`: pruebas SQL positivas y negativas con roles JWT simulados.

## Modelo e integridad

- UUID, UTC `timestamptz`, tipos enumerados y triggers de `updated_at`.
- FKs compuestas `(id, tenant_id)` impiden que pools, partidos, equipos, participantes, predicciones, resultados, ratings y modelos se mezclen entre tenants.
- Constraints cubren puntajes no negativos, equipos distintos, estados, offsets no negativos, codigo opaco de seis caracteres, una prediccion por participante/partido y un resultado oficial por partido.
- Indices cubren membership por usuario, tenant/pool, jornada/kickoff, lock, resultado, prediccion, rating y auditoria.
- Se incluyen todas las entidades aprobadas: perfiles, tenants, membresias, planes/entitlements, pools/reglas/codigos, calendario, participantes, predicciones, resultados, scoring, estadistica, branding y auditoria.

## Matriz RLS y autorizacion

| Tabla/grupo | RLS/policy | Cobertura de test |
| --- | --- | --- |
| `profiles` | Solo perfil propio para select/insert/update. | Seed y JWT simulado; pendiente runtime. |
| `plans` | Lectura autenticada. | Revision estatica. |
| `tenants`, memberships, entitlements, branding | Lectura por `is_tenant_member`; escrituras sensibles revocadas o admin-only. | Member A / Tenant B / outsider. |
| Pools, reglas, codigos | Lectura por miembro; escritura solo `is_tenant_admin`. | Member no administra; admin A no escribe B. |
| Torneos, equipos, jornadas, partidos, pool_matches | Lectura por miembro; escritura solo admin. | Cross-tenant read y FK compuesta. |
| Participantes | Lectura por miembro; mutacion directa revocada; `join_pool` es `SECURITY DEFINER`. | Seed y join listo para runtime. |
| Predicciones | Solo `can_read_prediction`; propietario siempre, otros desde `lock_at`; mutacion directa revocada; `save_prediction` usa tiempo DB. | Propia visible y ajena oculta antes del lock. |
| Resultados, scoring, ratings, modelo | Lectura por miembro; mutaciones directas revocadas. | Revision estatica; mutaciones de fases 06/08. |
| `audit_log` | Solo owner/admin lee; mutacion directa revocada. | Revision estatica. |
| `storage.objects` / `branding-assets` | Bucket privado; ruta tenant-scoped y solo admin escribe PNG/JPEG/WebP. | Revision estatica; pendiente runtime. |

Los helpers `is_tenant_member`, `is_tenant_admin` y `can_read_prediction` son `SECURITY DEFINER` porque RLS los invoca sobre memberships. Todos fijan `search_path = public, auth`, derivan identidad desde `auth.uid()` y su ejecucion se revoca de `public`; solo `authenticated` recibe `EXECUTE`.

## Verificaciones ejecutadas

| Verificacion | Resultado |
| --- | --- |
| Inventario de entidades aprobadas en migracion | PASS: 22 tablas de dominio, incluyendo los conceptos auxiliares de codigos y branding, detectadas. |
| Revision estatica de FKs tenant-scoped, RLS, helpers, RPC y Storage policies | PASS. |
| Revision estatica de los siete casos RLS obligatorios | PASS: estan codificados en `supabase/tests/phase-03-rls.sql`. |
| Migracion directa desde esquema `public` limpio, `ON_ERROR_STOP=1` | PASS: archivo completo aplicado sin errores SQL. |
| Seed directo, `ON_ERROR_STOP=1` | PASS: 2 tenants, 5 memberships y 2 predicciones. |
| `npx.cmd supabase migration list` | PASS: `20260908000100` presente tanto en Local como en Remote. |
| `npx.cmd supabase db push --linked --dry-run` | PASS: no hay migraciones pendientes inesperadas en el proyecto vinculado. |
| Seed configurado y aplicado | PASS: `supabase/seed/phase-03-development.sql` es el seed de desarrollo configurado y fue aplicado en el remoto de desarrollo/staging. |
| Suite `supabase/tests/phase-03-rls.sql` contra Session pooler 5432 | PASS: salida sin errores y `psql` exit code `0`; aislamiento, roles, anonimo, operacion owner, privacidad y FK cross-tenant. |

## Rollback

La migracion es inicial y esta destinada a una base vacia. En local, rollback es reiniciar la base Supabase/PostgreSQL y reaplicar migraciones. En un entorno compartido se debe tomar backup antes de aplicarla; no se recomienda un down migration destructivo que elimine tablas tenant-owned con datos.

## Criterios de aceptacion

- [x] Migracion `20260908000100` sincronizada entre el repositorio y Supabase Cloud.
- [x] Todas las tablas tenant-owned tienen RLS y ownership documentado.
- [x] Tests cross-tenant ejecutados contra Supabase Cloud mediante Session pooler 5432.
- [x] Indices y constraints soportan el contrato de Fase 02.
- [x] RLS y RPC no usan `tenant_id` de cliente como autorizacion.
- [x] Contrato de Fase 02 preservado; no se cambio ADR.

## Cierre y antecedente local

La Fase 03 queda cerrada con evidencia remota en Supabase Cloud. Durante la validacion se corrigio el test anonimo: una policy RLS puede devolver cero filas a `anon` sin producir `insufficient_privilege`; la prueba ahora detecta filtracion real y conserva `ROLLBACK`.

Como antecedente no bloqueante, el stack local no pudo completar el arranque de Realtime por recursos del entorno. Por directiva de infraestructura, no se volvera a usar como criterio de validacion ni se ejecutaran flujos locales de Docker/Supabase para esta fase. El siguiente paso permitido es Fase 04.
