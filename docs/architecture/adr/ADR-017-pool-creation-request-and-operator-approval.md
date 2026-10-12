# ADR-017 — Solicitud de creación de quiniela y aprobación por operador

- Estado: **Accepted para QA** (2026-10-12, por la orden del propietario de aplicar `20261020` «cuando corresponda» tras revisión, pruebas y reversión). **Aplicada solo en Supabase QA** (27/27 migraciones). No aplicada en producción: requiere autorización posterior. Pendientes de decisión del propietario: política de enfriamiento definitiva (7 días, ya fijada en la orden) y consola externa de operador (hoy: `scripts/qa/review-pool-request.mjs`).
- Origen: `docs/agents/ENCARGO_MAESTRO_SPORTLEAGUES.md` §2 y §12-Lote B (el usuario puede «solicitar crear su propia quiniela» desde Mi perfil).
- Relacionados: ADR-002 (aislamiento por tenant), ADR-008 (frontera de autorización global), ADR-015 (administrar o competir), AGENTS.md §5 y §12.
- Impacto AGENTS.md §12: cambia autorización (cómo un usuario llega a ser organizador) y añade una tabla de esquema.

## Contexto

Hoy un perfil llega a ser `owner`/`admin` de un tenant solo por aprovisionamiento manual del operador. El producto necesita que un participante pueda **pedir** ser organizador sin que ningún cliente, claim editable o RPC de autoservicio le asigne privilegios.

## Decisión

1. Tabla `pool_creation_requests` con RLS (el solicitante solo hace `SELECT` de las suyas) y **sin DML directo** para `anon`/`authenticated`.
2. RPC `request_pool_creation`, `my_pool_creation_request` y `cancel_pool_creation_request` (`SECURITY DEFINER`, solo `authenticated`): idempotentes (índice único parcial: una `pending` por solicitante), con nota ≤ 500 caracteres, rechazo `already_organizer` si ya administra y enfriamiento tras un rechazo reciente. Nunca reciben `tenant_id` ni rol del cliente.
3. La **aprobación/rechazo** no existe en el frontend público: `review_pool_creation_request` es ejecutable **solo por `service_role`** (consola de operador futura o SQL controlado, como el aprovisionamiento de superadmin en ADR-008). Aprobar crea el tenant y la membresía `owner` en una transacción atómica e idempotente, o, si el modelo vigente no lo permite limpiamente, solo registra el estado y el operador completa el alta según el runbook.
4. Todo cambio de estado deja rastro de auditoría. Ninguna ruta de código del cliente cambia `status`.

## Detalle de implementación (migración propuesta `20261020000100`)

- Auditoría propia: `pool_creation_request_events` (append-only, sin FK, RLS sin política ni grant para clientes), escrita por trigger y por tanto también para `service_role`; no copia la nota del usuario. `audit_log` exige `tenant_id`, que una solicitud pendiente aún no tiene; al aprobar se escribe además en el tenant nuevo.
- Guard de máquina de estados: identidad y nota inmutables, estados finales no reabribles, no se aprueba sin tenant. Única excepción: desacoplar `tenant_id` de una aprobada (efecto de `on delete set null`).
- Errores adicionales: `rate_limited` (5 solicitudes/24 h por usuario), `profile_required`, `no_pending_request`; `cooldown_active` de 7 días con `retry_after`.
- `review_pool_creation_request`: `EXECUTE` solo `service_role` y el cuerpo rechaza además los claims `authenticated`/`anon`. Aprobar crea tenant (plan free) + membresía `owner` + auditoría en una transacción; idempotente.
- Límite conocido: `service_role` sigue siendo confianza total (puede crear tenants y membresías con SQL libre); mitigación: revisión periódica de `audit_log` (runbook `docs/operations/POOL-CREATION-REQUEST-OPERATOR-RUNBOOK.md`). La prueba de concurrencia real entre dos sesiones es clase C y queda pendiente.

## Alternativas descartadas

- Autoaprobación con un plan gratuito: viola «nunca asignar privilegios de administrador desde el cliente».
- Un claim JWT o una columna de perfil `wants_organizer`: editable o confundible con autorización.

## Consecuencias

- Mientras la migración no esté aplicada, la UI muestra la función como «aún no disponible en este entorno».
- La consola externa de operador (futura) usará `review_pool_creation_request`; hasta entonces es un procedimiento manual documentado.
- Pendiente de decisión del propietario: aplicar la migración a QA; política de enfriamiento definitiva; si la aprobación crea el tenant automáticamente o lo hace el operador.

## Verificación en QA
- Suite SQL 138/138 (rollback, reproducida por el coordinador), reversión 8/8, regresión de 13 suites 1025/1025 tras aplicar.
- E2E real de ciclo de vida (5 identidades fijas): 5 solicitudes simultáneas → 1 pendiente; sin autoaprobación (42501); aprobación crea tenant gratuito + owner una sola vez; rechazo → `cooldown_active`; 142 PASS, 0 FAIL.
