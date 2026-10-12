# Runbook de operador: solicitudes «Crear mi propia quiniela»

Referencia: ADR-017 (Proposed), `supabase/proposed/20261020000100_pool_creation_requests.sql`, ADR-008 (frontera de operador), ADR-015.
Estado: **la migración NO está aplicada**. Este procedimiento solo aplica cuando el propietario autorice aplicarla.

## Principios

- Un usuario **pide**; nunca se autoeleva. Ningún rol de cliente (`anon`, `authenticated`, ni `owner`/`admin`/`platform_admin` por la API)
  puede ejecutar `review_pool_creation_request`: su `EXECUTE` es solo de `service_role`.
- La revisión se hace desde el SQL editor de Supabase Cloud (sesión administrativa del proyecto) o desde una futura consola de operador
  que use la clave `service_role` **en servidor**. Nunca desde el frontend ni con la clave en el navegador (AGENTS.md §5).
- No pegar UUID reales, correos ni notas de usuarios en tickets, chats o el repositorio.

## 1. Ver solicitudes pendientes

```sql
select r.id, r.requested_at, p.display_name, left(r.note, 200) as nota
  from public.pool_creation_requests r
  join public.profiles p on p.id = r.requester_id
 where r.status = 'pending'
 order by r.requested_at;
```

Antes de decidir, verificar la identidad del solicitante por un canal externo (la nota es texto libre y no autentica nada).

## 2. Aprobar

```sql
select public.review_pool_creation_request(
  '<ID_DE_LA_SOLICITUD>'::uuid, 'approve', 'nota interna opcional', 'Nombre del tenant (opcional, 1..120)');
```

En **una sola transacción** la función: crea el tenant (plan `free`, `pool_admin_model = 'tenant'`, sin quinielas), crea la
membresía `owner` activa del solicitante, marca la solicitud `approved` (con `tenant_id`, `reviewed_at`) y escribe `audit_log`
del tenant nuevo (`pool_creation_requests.approve`) y el evento de la solicitud. Si el nombre se omite se usa «Quinielas de <nombre del perfil>».

- **Idempotente:** repetir la aprobación devuelve el mismo estado (`created: false`) sin duplicar tenant ni membresía.
- **Errores:** `22023 request_not_found | invalid_decision | invalid_tenant_name | note_too_long`;
  `P0001 already_organizer` (el solicitante ya es owner/admin activo: rechazar en su lugar o resolver manualmente),
  `P0001 request_cancelled`, `P0001 already_reviewed` (no se revierte una decisión; hace falta SQL explícito y ADR si se necesitara).
- **ADR-015:** el tenant nuevo no tiene quinielas, por lo que la aprobación no genera conflicto administrador/participante. Las
  participaciones del solicitante en quinielas de OTROS tenants no se tocan (la regla es por quiniela). Desde el momento en que
  abra una quiniela en su tenant nuevo, ya no podrá participar en ella.
- Plan: el tenant nace `free`. Pasar a `pro` es una operación aparte del operador (no la hace esta función).

## 3. Rechazar

```sql
select public.review_pool_creation_request('<ID_DE_LA_SOLICITUD>'::uuid, 'reject', 'motivo visible para el usuario');
```

La nota de revisión **la ve el solicitante** (`my_pool_creation_request`); redactarla sin datos sensibles. Tras un rechazo, el usuario
queda en **enfriamiento de 7 días** (`cooldown_active`) para volver a pedir.

## 4. Consultas de auditoría

```sql
-- Historial de una solicitud (eventos append-only; no contienen la nota del usuario)
select event, actor_kind, created_at, metadata from public.pool_creation_request_events where request_id = '<ID>' order by created_at;
-- Aprobaciones registradas en la bitácora de cada tenant
select tenant_id, created_at, metadata from public.audit_log where action = 'pool_creation_requests.approve' order by created_at desc;
```

`reviewed_by` queda `NULL` cuando revisa el operador (sin sesión de usuario); el actor consta como `operator` + `db_role` en el evento.

## 5. Límites y comportamiento operativo

- Una sola solicitud `pending` por usuario; máximo 5 solicitudes por 24 h por usuario (`rate_limited`); nota de hasta 500 caracteres.
- Los estados finales son inmutables por trigger, incluso para `service_role`/propietario. Aprobar por `UPDATE` directo sin tenant se rechaza;
  **un `service_role` con SQL libre sigue siendo confianza total** (puede insertar tenants/membresías a mano): por eso toda aprobación debe
  pasar por la función y quedar auditada. Revisar periódicamente `audit_log` por `tenant_memberships.insert` con rol `owner` sin
  `pool_creation_requests.approve` asociado.
- Un `approved` cuyo propietario perdió después la membresía activa sigue devolviéndose al usuario (`created: false`) en lugar de
  abrir otra solicitud; restituir el rol o archivar el caso es una acción manual del operador.
- Bajas de tenant (D22): la FK `tenant_id` es `on delete set null`; la solicitud aprobada sobrevive sin tenant (el trigger lo permite).

## 6. Procedimiento manual de respaldo (solo si la función no estuviera disponible)

No es necesario con la migración propuesta (la función crea el tenant de forma limpia: `tg_tenants_guard_model` solo actúa en
`UPDATE OF pool_admin_model`, y `tenants`/`tenant_entitlements`/`tenant_memberships` no exigen nada más al `INSERT`). Si hiciera falta
hacerlo a mano, usar una transacción y registrar el motivo: insertar `tenants`, `tenant_entitlements (free)`, `tenant_memberships (owner)` y
dejar la solicitud en `approved` solo mediante la misma función cuando vuelva a estar disponible, para no divergir el estado.

## 7. Validación realizada

`node scripts/qa/run-sql-suite.mjs supabase/tests/pool-creation-requests.sql --with-migration supabase/proposed/20261020000100_pool_creation_requests.sql`
(clase B: transacción con rollback, sin residuo). Resultado y gaps: ver el handoff de la fase. Pendientes antes de producción:
prueba de concurrencia real con dos sesiones (clase C, proyecto descartable) y revisión del propietario sobre el enfriamiento.
