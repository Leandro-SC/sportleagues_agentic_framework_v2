# ADR-011 — Lock por pool y autoridad de gestión de calendario

- Estado: Proposed
- Fecha: 2026-10-06
- Decisores: Architecture (preparación de Fase 06)

## Contexto

El contrato aceptado de Fase 02 y ADR-005 fija `lock_at = matches.starts_at - pools.lock_offset`.
Faltaba cerrar cómo presentar ese límite, cómo impedir que una edición administrativa reabra un
pronóstico y cuál es la frontera de la futura `manage_schedule`.

## Decisión propuesta

1. Se reafirma que `lock_offset` pertenece a `pools`. No habrá offset global de tenant, torneo o
   partido en el MVP. Cada asociación `pool_match` calcula su límite con el partido y el pool.
2. PostgreSQL calcula/compara el límite con `now()` en cada operación crítica. La UI solo muestra el
   `lock_at` retornado/calculado por servidor en zona horaria del tenant y refresca tras un rechazo.
3. La futura `manage_schedule` será una RPC tenant-scoped para comandos explícitos de catálogo,
   jornadas, partidos y asociaciones `pool_matches`. Valida coherencia tenant/torneo/equipos, estado
   del partido y que una edición de kickoff/lock no reabra un `pool_match` ya bloqueado. La propuesta
   es rechazar dicha edición una vez vencido su lock y auditar cambios todavía abiertos.
4. Owner/admin activo del tenant son los únicos actores de esta RPC. Superadmin no hereda permiso
   tenant-scoped: un override global necesitaría una RPC/ADR independiente conforme a ADR-008.

## Alternativas consideradas

- Offset por torneo o tenant: rechazado; un torneo puede alimentar pools con reglas de cierre distintas.
- Offset por partido para MVP: rechazado; añade excepciones y hace más opaca la privacidad sin requisito.
- Cliente calcula/impone el lock: rechazado por reloj manipulable y contradicción con ADR-003.
- Permitir reabrir al cambiar kickoff: rechazada; rompe integridad y expectativas de participantes.

## Consecuencias

La implementación futura debe definir DTO/versionado de comandos, `SECURITY DEFINER` con
`search_path` fijo y grants mínimos, además de pruebas de transacción y negativas por rol/tenant.
Cambiar offset seguirá siendo una operación de pool de Fase 05, pero su efecto sobre fixture debe
validarse cuando la semántica de Fase 06 sea implementada.

## Seguridad / privacidad

Ni `tenant_id`, ni offset ni timestamps enviados por navegador prueban permisos. La auditoría mínima
incluye actor, entidad, valores anterior/nuevo permitidos, operación y reloj DB; no JWT ni PII extra.

## Migración / rollback

No hay migración/RPC en este ADR. Si la propuesta se implementa, será forward-only y se podrá
deshabilitar la UI de edición sin borrar fixture ni pronósticos.
