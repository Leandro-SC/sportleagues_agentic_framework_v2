# Auditoría de seguridad de solo lectura — Supabase QA (Fases 03–05)

Fecha: 2026-10-11 · Proyecto: `plataforma_bet` (ref `juoftaofzepxbrrxbkhx`, QA) · Equipo: Security + Data + Backend (orquestado).
Estado de los ADR/fases: sin cambios (ADR-014 sigue `Proposed`; Fase 06 no iniciada).

## 0. Alcance y método

- Solo `SELECT` sobre catálogos del sistema (`pg_class`, `pg_policies`, `pg_proc`, `pg_trigger`, `pg_constraint`,
  `pg_default_acl`, `pg_roles`, `supabase_migrations`) con `supabase db query --linked`. **No se leyó ninguna fila de
  tablas de aplicación** (sin PII, sin pronósticos) y **no se ejecutó ninguna escritura de prueba**.
- Efecto colateral declarado: el CLI imprime «Initialising login role…», es decir, crea/usa un rol de login temporal
  de la Management API; no modifica esquema, permisos ni datos de la aplicación.
- QA tiene aplicadas exactamente las 11 migraciones del repositorio (20260908000100 … 20260918000200), así que el
  código auditado = el desplegado (las definiciones de `save_prediction`, `can_read_prediction`, `manage_pool`,
  `join_pool` se leyeron en vivo).
- **CONFIRMED** significa: privilegio efectivo + política + código en vivo hacen posible la acción para un rol
  autenticado ordinario. **No se explotó nada**; la reproducción pendiente requiere tu autorización (§9).

## 1. Matriz de privilegios efectivos (QA, `has_table_privilege`)

S=SELECT I=INSERT U=UPDATE D=DELETE T=TRUNCATE R=REFERENCES G=TRIGGER. Propietario de todas: `postgres` (BYPASSRLS).
RLS activo en todas; **`FORCE RLS` en ninguna**.

| Tabla | anon | authenticated | service_role |
| --- | --- | --- | --- |
| `audit_log`, `predictions`, `participants`, `official_results`, `scoring_events`, `tenant_memberships` | S · · · **T R G** | S · · · **T R G** | S I U D T R G |
| `pools`, `pool_rules` | S **I U D** **T R G** | S · · · **T R G** | todos |
| `matches`, `pool_matches`, `rounds` | S I U D T R G | **S I U D T R G** | todos |
| `pool_join_codes` | S I U D T R G | S · U D T R G | todos |

Nota: `anon` conserva `INSERT/UPDATE/DELETE` en `pools`, `pool_rules`, `matches`, `pool_matches`, `rounds` y `pool_join_codes`; `authenticated` conserva `I/U/D` solo en `matches`, `pool_matches`, `rounds` (y `U/D` en `pool_join_codes`).
Causa: `pg_default_acl` concede `arwdDxtm` a `anon`, `authenticated` y `service_role` sobre toda tabla nueva de `public`,
y las migraciones solo revocaron `I/U/D` en algunas tablas, nunca `TRUNCATE/REFERENCES/TRIGGER`.
Roles: `service_role` y `postgres` tienen `BYPASSRLS`; `anon`/`authenticated` no. Todas las políticas son `TO authenticated`
(ninguna para `anon`). No hay triggers de inmutabilidad ni de congelación de horarios: solo `set_updated_at` y dos de branding.

## 2. Hallazgos

| ID | Hallazgo | Estado | Gravedad real |
| --- | --- | --- | --- |
| H1 | El admin puede **reabrir/adelantar el lock** y leer pronósticos ajenos antes de tiempo (vía `manage_pool` y vía DML directo en `matches`) | **CONFIRMED** | **Crítico (integridad)** — bloqueante |
| H2 | El admin puede **borrar** `pool_matches`/`matches` y arrastrar `predictions` y `scoring_events` (FK `CASCADE`) | **CONFIRMED** | **Alto** |
| H3 | Ningún cambio administrativo relevante se audita (`manage_pool`, `approve_participant`, `set_participant_payment_status`, `publish_pool_rules`, `create_pool_join_code`); `audit_log` solo lo escribe la reconciliación de branding | **CONFIRMED** (código en vivo) | Alto (AGENTS §5) |
| H4 | `audit_log` no es inmutable: sin trigger; `service_role`/`postgres` pueden `UPDATE/DELETE/TRUNCATE` | **CONFIRMED** | Medio (requiere clave de servidor/DB) |
| H5 | `TRUNCATE`/`REFERENCES`/`TRIGGER` concedidos a `anon` y `authenticated` en **todas** las tablas | Privilegio **CONFIRMED**; explotación por la API pública **NOT CONFIRMED** | Medio (higiene; latente) |
| H6 | `anon` tiene `INSERT/UPDATE/DELETE` en `pools`, `matches`, `pool_matches`, `rounds`, `pool_rules`, `pool_join_codes` | Privilegio **CONFIRMED**; explotación **NOT CONFIRMED** (RLS sin políticas para `anon` lo bloquea) | Bajo (defensa en una sola capa) |
| H7 | Cualquier miembro del tenant lee **todos** los códigos de unión del tenant (`pool_join_codes_select_member`) | **CONFIRMED** | Medio |
| H8 | `join_pool`: carrera del límite Free (10) | **NOT CONFIRMED** con un solo código (el `FOR UPDATE` sobre la fila del código serializa); **INCONCLUSIVE** con varios códigos por pool (`create_pool_join_code` permite varios; el conteo no bloquea la quiniela) | Bajo |
| H9 | `EXECUTE` de las 27 funciones `SECURITY DEFINER` abierto a `anon`/`PUBLIC` | Privilegio **CONFIRMED**; explotación **NOT CONFIRMED** (todas las RPC verifican `auth.uid()`→`28000`; helpers solo devuelven datos del propio llamante; `rls_auto_enable` es función de event trigger) | Bajo (higiene) |
| H10 | `service_role` en el frontend | **NOT CONFIRMED** (sin referencias en `apps/platform/src` ni `.env.example`) | — |

### Evidencia clave

- **H1.** `save_prediction` permite escribir si `now() < m.starts_at - pool.lock_offset` y `m.status = 'scheduled'`;
  `can_read_prediction` revela a participantes aprobados cuando `now() >= m.starts_at - pool.lock_offset`. Ambos leen
  valores **mutables por el admin**: `manage_pool('update')` cambia `lock_offset` (0–1440) en cualquier momento, sin mirar
  predicciones, estado ni locks vencidos; y `matches` concede `UPDATE` al rol `authenticated` con política
  `matches_admin_write` (`is_tenant_admin`), sin triggers. `official_results` no es escribible por `authenticated`, pero
  eso no impide reabrir un partido ya finalizado cambiando `starts_at` y `status`.
- **H2.** `pg_constraint` en QA: `pool_matches_match_id_tenant_id_fkey`, `pool_matches_pool_id_tenant_id_fkey`,
  `predictions_pool_match_id_tenant_id_pool_id_fkey`, `predictions_participant_id_…_fkey`,
  `scoring_events_prediction_id_tenant_id_fkey` = `CASCADE`; `authenticated` tiene `DELETE` en `matches`/`pool_matches`.
- **H3.** `grep audit_log supabase/migrations`: único `INSERT` en `20260915000300_phase_05_branding_reconciliation.sql:122`.
- **H4/H5.** `has_table_privilege(...,'TRUNCATE')` = true para `anon` y `authenticated` en las 12 tablas consultadas.

## 3. Reales vs. teóricos

- **Reales (explotables con el rol ordinario de organizador, sin privilegios adicionales):** H1, H2, H7, H3 (ausencia de rastro).
- **Latentes (requieren SQL directo como `anon`/`authenticated` o una clave de servidor):** H4, H5, H6. PostgREST solo
  expone `SELECT/INSERT/UPDATE/DELETE` y RPC; no hay función con SQL dinámico que permita `TRUNCATE`. Corregir igual.
- **Teóricos/higiene:** H8 (solo Free + varios códigos), H9.

## 4. Escenarios de explotación (descritos, no ejecutados; sin datos ajenos)

1. **Copia tras ver los pronósticos (H1).** Un organizador que además es participante aprobado: (a) sube `lock_offset`
   (p. ej. 1440) con `manage_pool('update')` → `lock_at` ya pasó para el partido y `can_read_prediction` revela las
   selecciones a los participantes aprobados, él incluido; (b) vuelve a bajarlo → `lock_at` pasa a futuro; (c)
   `save_prediction` ya permite editar su pronóstico viendo los ajenos. Dos llamadas RPC, sin privilegios extra, sin rastro (H3).
2. **Pronosticar con el resultado conocido (H1).** El mismo organizador hace `UPDATE matches SET starts_at = now()+interval '1 day', status = 'scheduled'`
   sobre un partido ya jugado y guarda su pronóstico; después restaura los valores.
3. **Borrado selectivo (H2).** `DELETE FROM pool_matches WHERE …` elimina en cascada todas las predicciones y los
   `scoring_events` de ese partido en esa quiniela (p. ej. para anular puntos de un rival).
4. **Acceso a quinielas del mismo tenant (H7).** Un miembro que entró por la quiniela A lee los códigos de B y se
   une a ella; queda `pending` si B exige aprobación.

## 5. Veredicto sobre bloqueantes

**H1 es una vulnerabilidad crítica confirmada de integridad y BLOQUEA la apertura pública de quinielas** (AGENTS §6:
no editar tras el lock; ADR-005/011). Condición de explotación: organizador malicioso que participa en su propia quiniela
(caso habitual en quinielas pequeñas). **No se continúa con funcionalidades nuevas (tickets, pronósticos, Fase 06)** hasta
que R1 esté aprobada y aplicada. H2 y H3 se tratan como bloqueantes de la apertura junto con H1.

## 6. Correcciones mínimas propuestas (no aplicadas; compatibles con la arquitectura vigente)

Una sola migración de endurecimiento `…_hardening_lock_integrity_and_audit.sql`, forward-only, sin cambiar firmas de RPC ni el frontend.

- **R1 (bloqueante) — congelar la semántica del lock con triggers** (valen también para `service_role`/owner):
  1. `BEFORE UPDATE OF lock_offset ON pools`: para cada `pool_match` del pool, el estado «bloqueado» (`now() >= starts_at - offset`)
     **no puede cambiar**; si algún partido ya está bloqueado, el offset queda inmutable.
  2. `BEFORE UPDATE OF starts_at, status ON matches`: si el partido ya está bloqueado en algún pool, `starts_at` y `status`
     son inmutables salvo avance `scheduled→live→final`; si no está bloqueado, el nuevo `lock_at` debe seguir en el futuro
     (no se puede bloquear/revelar antes de tiempo) y `status` no retrocede.
  3. `BEFORE DELETE ON pool_matches, matches` y `BEFORE UPDATE OF match_id/pool_id/round_id`: rechazar si existen `predictions`.
  4. `BEFORE UPDATE OF pool_id, pool_match_id, participant_id ON predictions`: rechazar (ya sin privilegio, defensa en profundidad).
- **R2 — privilegios:** `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated`;
  `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon`; `ALTER DEFAULT PRIVILEGES … IN SCHEMA public REVOKE`
  equivalentes para los roles `postgres` y `supabase_admin`; `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon`
  (re-conceder a `authenticated`; `service_role` ya lo tiene).
- **R3 — `audit_log` inmutable:** triggers `BEFORE UPDATE OR DELETE` por fila y `BEFORE TRUNCATE` por sentencia (excepción
  explícita: ninguna; el borrado por `ON DELETE CASCADE` de `tenants` se resuelve en D13/offboarding).
- **R4 — auditoría de acciones administrativas:** insertar en `audit_log` (actor, acción, entidad, valores anterior/nuevo
  permitidos, sin PII) desde `manage_pool`, `approve_participant`, `set_participant_payment_status`, `publish_pool_rules`,
  `create_pool_join_code`.
- **R5 — `pool_join_codes`:** `SELECT` solo `is_tenant_admin` (el frontend no lee esa tabla fuera de administración).
- **R6 (baja prioridad):** en `join_pool`, bloquear la fila de `pools` antes del conteo del límite Free.
- **Residual aceptado:** un superusuario o quien pueda `ALTER TABLE … DISABLE TRIGGER` puede eludir los triggers; mitigar
  con export externo periódico de `audit_log` (D13/D15 de ADR-014).
- **Fase 06 (no ahora):** revocar DML directo de `matches/pool_matches/rounds` a `authenticated` con `manage_schedule` (ADR-011),
  reemplazar las FK `CASCADE` por `RESTRICT` (P5 de ADR-014).

## 7. Impacto en Fases 03–05

- **UI/frontend:** sin impacto: no hay DML directo sobre `pools/matches/pool_matches/rounds`; `pool_join_codes` solo lo usa el panel admin vía RPC.
- **RPC de Fase 05:** firmas y respuestas iguales; `manage_pool('update')` empezará a rechazar con `P0001` cambios de offset que alteren un lock; `useAdmin`/AdminView deben mostrar ese error.
- **Pruebas existentes:** `supabase/tests/phase-03-rls.sql:5` hace `UPDATE matches SET starts_at = now()+1 day` como rol privilegiado para
  estabilizar el seed; R1 lo rechazará si hay predicciones bloqueadas → ajustar el seed/test (p. ej. usar un partido sin predicciones o `SET LOCAL session_replication_role`
  solo en la suite local). Revisar también `phase-05-admin-rpc.sql`.
- **Datos QA:** el seed de desarrollo envejece (`starts_at` en el pasado); R1 no altera filas existentes.

## 8. Pruebas de regresión necesarias (nuevas, `supabase/tests/`)

1. Admin-participante: subir `lock_offset` tras el lock → `P0001`; bajarlo tras el lock → `P0001`; el offset sí cambia si ningún partido cambia de estado de lock.
2. `UPDATE matches SET starts_at/status` sobre partido bloqueado → rechazo; retroceso `final→scheduled` → rechazo; avance legítimo → permitido.
3. `DELETE pool_matches/matches` con predicciones → rechazo; sin predicciones → permitido.
4. `UPDATE/DELETE/TRUNCATE` sobre `audit_log` como `authenticated`, `postgres` y `service_role` → rechazo.
5. `has_table_privilege` de `TRUNCATE/REFERENCES/TRIGGER` = false para `anon`/`authenticated` en todas las tablas de `public`; `anon` sin `I/U/D`; `EXECUTE` de `anon` = false (matriz en CI).
6. Cada RPC administrativa genera exactamente una fila en `audit_log` con el actor correcto y sin PII.
7. Miembro no administrador no lee `pool_join_codes`; admin del tenant A no lee/escribe tenant B (ya existente) sigue verde.
8. Suites `phase-03-rls`, `phase-04-join-pool`, `phase-05-*` verdes tras la migración; `npm test`, build y `verify:bundle` sin cambios.

Reproducción de H1/H2 para **base descartable**: [`qa-readonly-audit-20261011-repro.sql`](qa-readonly-audit-20261011-repro.sql) (no ejecutar en QA).

## 9. Orden de remediación y decisiones que requieren tu autorización

Orden: (1) R1 · (2) R3 + R2 · (3) R4 + R5 · (4) R6 · (5) Fase 06: revocar DML + `manage_schedule` + FK `RESTRICT`.

Autorizaciones que necesito:
- **A.** Ejecutar la reproducción H1/H2 en una base **descartable** (Supabase local con Docker o proyecto temporal): confirma la explotación.
- **B.** Redactar la migración de endurecimiento como archivo (sin aplicar) y su suite de regresión; aplicarla a QA es una decisión posterior y separada.
- **C.** Cambio de autorización/RLS (AGENTS §12): confirmar si se registra como ADR breve (propongo ADR-015 «Integridad del lock y endurecimiento de privilegios») o como enmienda a ADR-011.
- **D.** Política de producto: ¿puede el organizador ser también participante? Si no, R1 sigue siendo necesaria (también protege contra cuentas cómplices).
- **E.** Si quieres saber si H1/H2 ya se abusaron en QA, habría que **leer datos** (`updated_at` de `matches` vs. creación de `predictions`, `pool_matches` huérfanos): requiere tu autorización expresa y se limitaría a metadatos agregados.
