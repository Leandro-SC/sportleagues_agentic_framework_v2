# HANDOFF — Remediación H1–H6 + incompatibilidad administrador/participante APLICADA a Supabase QA

- Agente: Orchestrator (sportleagues-dev) con roles Data/RLS, Security, QA
- Estado: DONE (QA). ADR-014/ADR-015 siguen `Proposed` hasta decisión del propietario; Fase 06 sin iniciar.
- Fecha: 2026-10-11 · Proyecto: `juoftaofzepxbrrxbkhx` (único proyecto accesible; confirmado con `supabase projects list`)

## Objetivo
Dejar Supabase QA con H1–H6, permisos mínimos, auditoría inmutable e incompatibilidad administrador-participante, sin romper la app Vue ni la autenticación.

## Decisión de método: migración incremental, NO reconstrucción
Se autorizó reconstruir, pero el inventario mostró que **no era necesario ni seguro**: 11 usuarios Auth (5 `gmail.com` con logins Google/email reales, 1 `platform_admin` real, uno que entró el mismo día) y datos de aplicación mínimos y sin conflicto. Se aplicaron las 3 migraciones sobre el esquema existente (cada una atómica). No se borró nada: ni Auth, ni Storage (bucket `branding-assets`, 0 objetos), ni secretos, ni datos. Copia de las tablas `public` exportada antes de migrar (fuera del repo, 18 KB).

## Migraciones aplicadas (`supabase/migrations/`, historial 14/14 sincronizado local=remoto)
1. `20261012000100_hardening_h1_persistent_lock_and_schedule_integrity.sql` — lock persistido (`pool_matches.lock_at`) e irreversible, estado de partido monótono, sin borrados destructivos (H1, H2, H8).
2. `20261012000200_hardening_h3_h6_privileges_audit_codes.sql` — sin TRUNCATE/REFERENCES/TRIGGER ni DML anon, `anon` sin EXECUTE, ACL por defecto cerradas, auditoría append-only, códigos de invitación no legibles por miembros (H3–H6).
3. `20261012000300_incompat_admin_participant_and_pool_staff.sql` — `pool_staff`, `pool_admin_exclusions`, `legacy_admin_conflicts`, triggers de incompatibilidad con bloqueo asesor por (quiniela, perfil).

Defecto corregido en el camino: la 2/3 casteaba `'public.pool_admin_exclusions'::regclass` antes de existir esa tabla (falló y revirtió limpiamente); ahora usa `to_regclass(...)`.

## Datos
- Eliminados: ninguno. Recreados: ninguno. Los conflictos heredados (owner-a, owner-b participantes en su propio tenant) se **conservaron y registraron** en `legacy_admin_conflicts` (D18).
- Residuo sintético de las pruebas (por diseño ya no es borrable: H2/append-only): ~122 usuarios `@example.test`, ~20 tenants de suite, filas de `audit_log`. Los 6 `platform_admins` sintéticos creados por las suites fueron **revocados** (`revoked_at`); queda 1 activo, el real. Ninguna cuenta `gmail.com` fue tocada.

## Pruebas ejecutadas contra QA (resultado real)
| Prueba | Resultado |
| --- | --- |
| Línea base clase A (14 comprobaciones) | antes 3/14 → después **14/14** |
| `10-lock-integrity` (H1/H2/H8) | **51/51** (repetida: 51/51) |
| `20-privileges-audit` (H3–H6) | **23/23** (repetida: 23/23) |
| `30-admin-participant` (ADR-015) | **87/87** (repetida: 87/87) |
| `concurrency.mjs` con sesiones reales (carreras inscripción/rol, límite Free=10, lock tras live) | **10/10** |
| Regresión históricas `phase-03`, `04`, `05-admin-rpc`, `05-branding-asset-security-regression`, `05-branding-assets`, `05bis` (BEGIN…ROLLBACK; pasa = sin excepción) | **6/6** tras adaptar fixtures |
| `npm run typecheck` / `npm test` (37 archivos, 247 tests) / `verify:bundle` (build + 18 chunks) | **OK** |
| Compatibilidad frontend: las 11 RPC usadas por la app siguen ejecutables por `authenticated`; ninguna requiere `anon` | **OK** |

## Cambios de pruebas (no se debilitó ninguna aserción)
- `00-readonly-baseline` P14: acotada a ámbito global + `public` (el esquema `storage` es de la plataforma Supabase).
- `30-admin-participant` DEL2: la aserción se ejecutaba antes de crear el fixture (borraba 0 filas); movida después.
- `phase-05bis` caso 7: ahora exige error de privilegio para `anon` (cambio intencional H3/P03; antes admitía `false`).
- `phase-05-admin-rpc`/`branding-assets`: fixtures de membresías sin `INSERT … ON CONFLICT` (el trigger `BEFORE INSERT` valora como alta de admin al conflicto heredado preservado).
- `phase-03-rls`: el partido sembrado ya no se puede devolver al futuro (H1); la aserción pre-lock usa partido y participante propios dentro de la transacción.
- `concurrency.mjs`: modo QA solo con `QA_OWNER_AUTHORIZED=yes`. Las suites 20/30 usan códigos aleatorios por ejecución en el ejecutor local para ser repetibles.

## Riesgos / limitaciones
- `supabase db advisors` aún marca como WARN las RPC `SECURITY DEFINER` ejecutables por `authenticated`: es el diseño (autorizan internamente + RLS); no son fugas.
- Las ACL por defecto de `supabase_admin` y del esquema `storage` pertenecen a la plataforma; solo se endurecieron las de `postgres`.
- Rollback `down/` solo cubre 1/3 con bandera destructiva; no se ejecutó el ciclo de rollback (estado forward-only en QA).
- D22 (baja de tenants/PII) sigue pendiente de ADR/legal.

## Próximo paso permitido
Fase 06 (equipos, jornadas, pronósticos, resultados oficiales, scoring) y ADR-014 (tickets) sobre este esquema, tras aceptar ADR-014/015.
