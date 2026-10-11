# Remediación H1–H6 + incompatibilidad administrador/participante — dictámenes, regresión y estado de pruebas

Estado: **preparada, NO aplicada, NO verificada en ejecución.** ADR-014 y ADR-015 siguen `Proposed`; Fase 06 no inicia.
Diseño y plan: ADR-015 §13–§20. Política de pruebas sin Docker: `docs/operations/CLOUD-ONLY-TESTING-POLICY.md`.

## 1. Entregables preparados (sin aplicar)

| Archivo | Contenido |
| --- | --- |
| `supabase/proposed/20261012000100_…lock_and_schedule_integrity.sql` | 1/3: lock persistido (`pool_matches.lock_at`), `opened_at`, bloqueo de borrados/identidad, estado monótono, resultados con revisión, `apply_fixture_update` |
| `supabase/proposed/20261012000200_…privileges_audit_codes.sql` | 2/3: privilegios mínimos, `audit_log` inmutable, auditoría administrativa por trigger, códigos solo admin, `join_pool` con bloqueo |
| `supabase/proposed/20261012000300_incompat_…pool_staff.sql` | 3/3: incompatibilidad, `pool_staff`, exclusiones, retirada, transferencia, Superadmin, conflictos heredados |
| `supabase/proposed/down/*.down.sql` | Reversión 3→2→1 con guardas (orden y `sl.allow_destructive_rollback`) |
| `supabase/tests/proposed/` | `00` línea base (A), `01` ACL (A), `10`/`20`/`30` (C), `_helpers.sql` |
| `scripts/qa/remediation/` | `run-suite.mjs` (guardas anti-QA), `concurrency.mjs` (sesiones reales) |

Se ubican en `supabase/proposed/` **a propósito** (un `db push` no las recoge). Promover a `supabase/migrations/` solo con autorización.

## 2. Dictámenes independientes (revisión estática; ninguno pudo ejecutar SQL)

**Security — APROBAR CON CAMBIOS** (no promover hasta cerrar 1–4). **Data — APROBAR CON CAMBIOS** (1 crítico de integridad + 1 de compatibilidad).

| # | Hallazgo (especialista) | Sev. | Disposición |
| --- | --- | --- | --- |
| 1 | `pool_admin_model='pool'` dejaba admins efectivos sin exclusión (Sec) | Alto | **Corregido:** owner/admin del tenant cuentan siempre mientras RLS/RPC usen `is_tenant_admin`; el modelo solo cambia la capacidad |
| 2 | INSERT de predicción tras el lock por SQL directo/service_role (Sec, Data) | Alto | **Corregido:** `predictions_guard_insert`; pruebas L13d/e |
| 3 | Carrera MVCC del lock vs `save_prediction` (Sec, Data) | Alto | **Corregido:** `FOR SHARE OF pm` en `save_prediction` y en el trigger; lectura con `clock_timestamp()` volátil. Prueba exacta = manual de 2 sesiones (la automática es solo gruesa) |
| 4 | Deadlock `join_pool`/promoción de rol (orden de bloqueos) (Sec) | Alto | **Corregido:** orden único fila de quiniela (`NO KEY UPDATE`) → bloqueo asesor (`_lock_pool_governance`); verificación en `concurrency.mjs` c2 (pendiente de ejecución) |
| 5 | Sondeo cross-tenant (`has_pool_capability`, `participation_competes`) (Sec, Data) | Medio | **Corregido:** solo capacidad propia; internas sin grant; autorización antes de validar en `transfer_pool_administration` |
| 6 | `ALTER DEFAULT PRIVILEGES IN SCHEMA` no quita PUBLIC; P14 falso PASS (Sec, Data) | Medio | **Corregido:** forma global + revocar a `authenticated` por defecto; P14 reescrita |
| 7 | `audit_log` inmutable impide bajas de cuenta/tenant (Sec, Data) | Medio | **Parcial:** `actor_id` deja de ser FK. Baja de tenant/PII sin procedimiento → **D22 abierta** |
| 8 | `verify_audit_protection` superficial (Sec) | Medio | **Corregido:** tipo de trigger, cuerpo, privilegios, `session_replication_role`, exclusiones |
| 9 | `pool_staff` sobrevive a membresía inactiva (Sec) | Medio | **Corregido** (la capacidad exige membresía activa; la exclusión se mantiene) |
| 10 | Auditoría confía en claims falsificables (Sec); `v_claims::jsonb` podía lanzar (Data) | Bajo | **Corregido:** `pg_input_is_valid`, se registra `session_user`; límite documentado |
| 11 | `official_results` sin identidad/revisión monótona (Sec) | Bajo | **Corregido** (`tg_official_results_guard_write`, L11c/d) |
| 12 | Índices faltantes `predictions(pool_match_id)`, `pool_matches(match_id)` (Data) | Medio | **Corregido** (en 1/3) |
| 13 | `FOR UPDATE` sobre `pools` bloquea KEY SHARE; conteo Free incluye retirados (Data) | Medio | **Corregido:** `NO KEY UPDATE`; conteo sin retirados/excluidos |
| 14 | Down: guardas, snapshot como historial, orden (Data/Sec) | Medio | **Corregido** |
| 15 | Pruebas con falsos PASS (vacuas, códigos, hints, n=0) (Data/Sec) | Medio | **Corregido** los citados (L13, A08, LEG4c, INC-17, R6 `n===10`, `acl-diff`) |
| 16 | Semilla/pruebas existentes chocan con D20 (Data/Sec) | Alto | **Documentado** (§3); no se modifican en esta tarea |
| 17 | Fila `legacy` sin auditoría al detectarse; admins previos a la migración desconocidos (Sec) | Bajo | Detección auditada; límite documentado (ADR-015 §16, §19) |
| 18 | Sin trigger de eventos / propietario puede deshabilitar triggers (Sec, Data) | — | **Riesgo residual aceptado**, mitigado (ADR-015 §19) |

Ningún hallazgo crítico/alto queda sin resolver **en diseño**; **no** puede declararse aprobada la solución: falta ejecución (§4) y una **segunda revisión** de Security/Data sobre estos cambios.

## 3. Impacto de D20 sobre Fases 03–05 (regresión)

| Elemento | Efecto tras la remediación | Acción propuesta (no ejecutada) |
| --- | --- | --- |
| `supabase/seed/phase-03-development.sql:27` inserta como participantes a los **owners** de ambos tenants | Seed no re-ejecutable tras 3/3 (`participants_guard_insert`); es el conflicto heredado que 3/3 detecta | Cargar la semilla **antes** de 3/3 (como hace `run-suite.mjs bootstrap`); en una versión nueva usar *members* como participantes |
| `phase-03-rls.sql:28,39` usa al owner A como espectador aprobado | Ese owner queda excluido/en conflicto | Cambiar el espectador a un *member* aprobado (misma aserción) |
| `phase-03-rls.sql:5-7` mueve `starts_at` a +1 día para evitar el seed envejecido | El lock persistido no se reabre: en una BD envejecida (>24 h) la aserción previa al lock falla | Usar un partido nuevo con `starts_at` futuro en el fixture |
| `phase-05-admin-rpc.sql:25` hace upsert de la membresía *owner* | Con el owner participante, `tenant_memberships_guard` lanza `WITHDRAW_FIRST` | Ejecutar con la semilla compatible o en una base sin el conflicto |
| `phase-04-join-pool.sql`, `phase-05bis-platform-admin.sql` | Sin cambios de comportamiento previstos | Ejecutar y registrar |
| Frontend | Sin DML directo sobre `pools/matches/pool_matches`; `manage_pool` puede devolver `42501` si un cambio de offset alteraría un lock (mostrar el mensaje) | Revisión de UX en Fase 06 |

Estas adaptaciones **cambian pruebas por una decisión de producto aprobada**, no las debilitan; se harán con autorización y revisión.

## 4. Resultado de pruebas

| Prueba | Clase | Resultado |
| --- | --- | --- |
| Validación sintáctica estática de las 3 migraciones, 3 down, 6 archivos de prueba (parser PostgreSQL local, sin BD) | — | **PASS** (solo sintaxis/plpgsql; no prueba semántica ni ejecución) |
| `node --check` de `run-suite.mjs` y `concurrency.mjs`; guardas anti-QA del ejecutor | — | **PASS** (rechaza el proyecto QA y la falta de `SCRATCH_CONFIRM`) |
| `00-readonly-baseline.sql` sobre **QA** (solo catálogos) | A | **Ejecutada, 3 PASS / 11 FAIL** (línea base esperada: la remediación no está aplicada; los FAIL documentan H1–H6/H9) |
| Suites `10`, `20`, `30`, regresión `phase-03…05`, `rollback-cycle` | C | **BLOCKED** — sin proyecto Supabase descartable autorizado. Alternativa prevista: `run-suite.mjs all` en un proyecto Cloud descartable |
| `concurrency.mjs` (INC-C1…C4, R6, LOCK) | C | **BLOCKED** — idem (sesiones reales de usuarios sintéticos) |
| Reproducción H1/H2 (`qa-readonly-audit-20261011-repro.sql`) antes/después | C | **BLOCKED** — idem |
| Local con Docker | — | **No usado** (política aprobada). Un contenedor iniciado por error al comienzo de la tarea se detuvo y Docker Desktop se cerró; no se ejecutó nada contra él salvo una consulta de catálogo local |

## 5. Bloqueos que requieren intervención humana

1. **Autorizar y crear un proyecto Supabase Cloud descartable** (puede generar coste; ver política §4) y proporcionar `SCRATCH_PROJECT_REF`, URL y claves **solo** por variables de entorno locales.
2. Confirmar que la Management API conserva **una sesión por archivo** (temp tables, `SET ROLE`); si no, usar una conexión PostgreSQL directa sin Docker.
3. Segunda revisión de Security y Data tras los cambios de este informe.
4. Decisiones: **D21** (aplazamiento tras el lock), **D22** (baja de tenants/PII; D13 retención), y autorizar adaptar la semilla/pruebas de Fases 03–05 (§3).
5. Autorización explícita para promover a `supabase/migrations/` y aplicar a QA (ADR-015 §18).
