# ADR-010 — Fixture acotado al pool y contexto activo explícito

- Estado: Proposed
- Fecha: 2026-10-06
- Decisores: Architecture (preparación de Fase 06)

## Contexto

`matches` pertenece a tenant y `pool_matches` selecciona qué partidos forman una quiniela. Un mismo
usuario puede tener memberships en varios tenants y varios pools; nombres de equipos y ligas pueden
repetirse. Mostrar todos los partidos visibles de un tenant en `/partidos` no comunica qué partidos
afectan sus pronósticos ni qué lock aplica.

## Decisión propuesta

`/partidos` muestra por defecto únicamente los `pool_matches` del **pool activo** dentro del
**tenant activo**. El usuario elige ambos contextos de forma explícita; si tiene varios pools, no se
fusionan silenciosamente. La preferencia local acelera UX, pero debe revalidarse contra la sesión y
no participa en autorización.

Una consulta/RPC recibe un ID de contexto solo como localizador y deriva acceso de `auth.uid()`,
membership activa y la participación cuando la operación lo exija. El detalle de torneo, equipos y
tabla se alcanza desde un `pool_match` autorizado. Una vista futura agregada puede agrupar varios
pools, siempre con etiqueta de tenant/pool y sin mezclar pronósticos, locks o rankings.

## Alternativas consideradas

- Todos los partidos del tenant: rechazada como vista por defecto; confunde el alcance de la quiniela.
- Un feed global de torneos asociados: rechazada para MVP; necesita reglas adicionales de lectura y
  no resuelve el lock específico del pool.
- Inferir contexto por el primer tenant/pool retornado: rechazada, es inestable y oculta la elección.

## Consecuencias

La fuente de UI de Fase 06 deberá modelar un `ActiveContext` y los estados vacío/cambio de contexto.
El modelo de datos existente conserva `pool_matches` como frontera funcional de predicciones. La
implementación requiere tests de usuario multi-tenant, multi-pool, IDs cruzados y nombres duplicados.

## Seguridad / privacidad

El selector no amplía la sesión. RLS/RPC debe negar un pool/match de otro tenant aunque el cliente
manipule URL, estado local o body. UUID y labels se separan: un label duplicado nunca se usa para
resolver permisos.

## Migración / rollback

No se requiere migración para adoptar la decisión de UI/consulta; las futuras RPC/RLS se diseñarán
en fase autorizada. Revertir UX a un selector sin contexto no autoriza un feed global.
