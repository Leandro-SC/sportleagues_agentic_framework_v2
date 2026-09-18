# Fase 05 (soporte de datos) — RPCs de administración

## Resultado

`COMPLETED` para el alcance de este sub-entregable: contratos server-side que el panel admin de Fase 05 necesita y que Fase 03 dejó explícitamente sin superficie de escritura directa. **No cierra la Fase 05**: falta la UI/composables del panel (agente Frontend/Admin UX).

## Motivación

Al auditar la migración de Fase 03 para planear la Fase 05 se detectó que:

- `participants` tiene `insert/update/delete` **revocado** para `authenticated`/`anon` y no existe ningún RPC para aprobar participantes ni cambiar `payment_status`. El requisito de Fase 05 "aprobar/gestionar membership y estado pagado/pendiente/invitado" era irrealizable desde el cliente.
- `pool_rules` permitía `insert/update/delete` directo, pero el índice único `pool_rules_one_current_per_pool` exige que cambiar de versión de reglas sea una operación atómica (desactivar la versión vigente + insertar la nueva). Dos escrituras sueltas desde el cliente violan la regla de `AGENTS.md` de que las operaciones críticas se validen server-side.
- `pool_join_codes.code` no tiene generación en base de datos; crear códigos desde el cliente exige lógica de reintento ante colisiones, mejor resuelta en el servidor.

## Cambios realizados

- `supabase/migrations/20260912000100_phase_05_admin_rpc.sql` (nueva migración, forward-only):
  - `approve_participant(p_participant_id uuid)` — solo admin/owner del tenant del participante.
  - `set_participant_payment_status(p_participant_id uuid, p_status participant_payment_status)` — solo admin/owner.
  - `publish_pool_rules(p_pool_id uuid, p_exact_points, p_outcome_points, p_tie_breaker, p_bonus_rules)` — calcula la siguiente versión, desactiva la vigente e inserta la nueva en una sola transacción de función; solo admin/owner del tenant de la pool.
  - `create_pool_join_code(p_pool_id uuid, p_expires_at)` — genera un código de 6 caracteres server-side con reintento ante colisión; solo admin/owner.
  - Revoca `insert/update/delete` en `pool_rules` y `insert` en `pool_join_codes` para `authenticated`: estas rutas quedan exclusivamente detrás de los RPC anteriores.
- `supabase/seed/phase-03-development.sql` — se agregó un sexto usuario de prueba (`Pending A`, tenant A, `participants.approval_status = 'pending'`) para poder ejercitar `approve_participant` con datos deterministas.
- `supabase/tests/phase-05-admin-rpc.sql` (nuevo) — 13 aserciones: aprobación exitosa, aislamiento cross-tenant, rechazo a member, cambio de payment status, versionado atómico de reglas (dos publicaciones consecutivas dejan exactamente una fila `is_current`), generación de código de unión, y verificación de que la escritura directa a `pool_rules`/`pool_join_codes`/`participants` sigue bloqueada (`insufficient_privilege`).

## Validación ejecutada

| Comando | Resultado |
| --- | --- |
| `npx supabase start` (Docker local) | PASS — stack local levantado |
| `npx supabase db reset` | PASS — migraciones `20260908000100` y `20260912000100` + seed aplicados sin error |
| `supabase/tests/phase-03-rls.sql` contra la base reseteada | PASS — sin regresión en las políticas de Fase 03 |
| `supabase/tests/phase-05-admin-rpc.sql` contra la base reseteada | PASS — las 13 aserciones pasaron (exit 0, sin excepciones) |

Todo se ejecutó contra Postgres real vía `docker exec ... psql`, no solo revisión estática.

## Decisiones

- Las cuatro funciones son `security definer` con `set search_path = public, auth`, siguiendo el mismo patrón que `join_pool`/`save_prediction` de Fase 03.
- Se optó por revocar la escritura directa en `pool_rules`/`pool_join_codes` en vez de dejarla abierta "por si acaso": el panel admin de Fase 05 debe usar los RPC exclusivamente, cumpliendo "no permitir mutaciones directas que el contrato exige por RPC" del prompt de Fase 05.
- No se tocó `audit_log`: sigue sin contrato de escritura porque el prompt de Fase 05 condiciona ese punto a que el contrato ya exista.

## Riesgos / limitaciones

- Esto es solo el contrato de datos. El panel admin (dashboard de quinielas, formulario de reglas, gestión de participantes, branding FREE/PRO) no está implementado todavía en `apps/platform/src`.
- No se corrió contra Supabase Cloud, solo local vía Docker.

## Próximo paso permitido

Agente Frontend/Admin UX puede iniciar la Fase 05 usando estos cuatro RPC más los grants directos ya existentes de Fase 03 (`pools`, `tournaments`, `teams`, `rounds`, `matches`, `pool_matches`, `branding_assets`, `tenant_branding`) como contrato de datos. Recordar que Fase 04 sigue `PARTIAL` (E2E cloud pendiente) y es prerrequisito para declarar la Fase 05 cerrada, no solo implementada.
