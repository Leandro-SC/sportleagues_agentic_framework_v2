# ADR-014 — Tickets multi-tenant, pagos manuales y libro financiero append-only

- Estado: Proposed
- Fecha: 2026-10-11
- Decisores: Architecture (preparación de tickets). Requiere aprobación del Product Owner (sección «Decisiones pendientes»).
- Detalle técnico (DDL conceptual, RPC, RLS, pruebas): [`ADR-014-ANNEX-tickets-technical-design.md`](../ADR-014-ANNEX-tickets-technical-design.md)
- Relacionados: ADR-002, ADR-003, ADR-005, ADR-008, ADR-010, ADR-011, ADR-012; `docs/product/ROADMAP-MOVIL-TICKETS-PRONOSTICOS-APIS.md`.

> Solo diseño. No autoriza migraciones, cambios de RLS/grants, pagos reales ni el inicio de la Fase 06.
> Todo nombre de tabla/RPC es propuesta hasta que el ADR sea Accepted.

## Contexto

El esquema aplicado (Fase 03) modela una participación por persona y quiniela: `participants` único por
`(pool_id, profile_id)` y `predictions` único por `(participant_id, pool_match_id)`. El producto
requiere, además, **tickets**: varias jugadas por participante y jornada, un pago asociado a cada una
y un ingreso del organizador calculable. El proyecto anterior (`references/legacy-quiniela/`) aporta
reglas útiles (jornada abierta, múltiples tickets, estados de pago) pero también anti-patrones que no
se heredan: importes y descuentos enviados por el cliente, un único `status` que mezcla ticket y pago,
`paid_at` puesto en `NULL` al cambiar de estado (se pierde la evidencia), IDs enteros enumerables,
teléfono en el ticket y ninguna idempotencia.

Fuera de alcance (AGENTS §3, PROJECT_CONFIG): escrow, wallet, cobro automático, premios, odds,
apuestas. Este ADR **registra** pagos hechos fuera de la plataforma; no procesa dinero.

## Decisión propuesta

1. **Cinco conceptos separados**, cada uno con su propio estado y tabla:
   `pool_rounds` (jornada vendible de una quiniela y su configuración comercial), `tickets`
   (la jugada), `predictions` con `ticket_id` (las selecciones), `payments` (obligación/cobro del ticket)
   y `ledger_entries` (hechos financieros inmutables). El estado del ticket **no** contiene el estado
   del pago ni el de los pronósticos; la puntuación sigue derivándose de `scoring_events` (ADR-012).
2. **Integridad referencial compuesta** `(id, tenant_id[, pool_id[, round_id]])` en toda FK, siguiendo
   el patrón de Fase 03. Un ticket solo puede existir para un `(tenant, pool, round)` que figure en
   `pool_rounds`, y un participante del mismo `(tenant, pool)`. Las tablas financieras usan
   `ON DELETE RESTRICT`: nunca se borran en cascada con pool, participante o tenant.
3. **Selecciones = `predictions` con `ticket_id`** (no una tabla paralela). `scoring_events`, el
   lock por pool (ADR-011) y la revelación (ADR-005) se reutilizan sin cambios. La unicidad pasa a
   índices parciales: `(ticket_id, pool_match_id)` para pools con tickets y la actual
   `(participant_id, pool_match_id)` solo cuando `ticket_id IS NULL`. Se añade `pools.ticketing_mode`
   (`none` por defecto) para que los pools existentes no cambien de comportamiento.
4. **Toda escritura pasa por RPC `SECURITY DEFINER`** con `search_path` fijo; `authenticated` no recibe
   INSERT/UPDATE/DELETE sobre tickets, payments, ledger ni idempotencia (mismo modelo que Fase 05).
   Tenant, participante, importe, moneda y precio se derivan en servidor desde `auth.uid()`,
   `pool_rounds` y membresías; el cliente solo envía identificadores como localizadores y una
   `idempotency_key`.
5. **Idempotencia sin bloquear compras legítimas**: la clave identifica la *intención de compra* (un
   UUID generado por el cliente por intento, nunca derivado del contenido). Reintento con la misma
   clave y mismo payload devuelve el mismo resultado; misma clave con otro payload se rechaza; clave
   nueva = ticket nuevo aunque las selecciones coincidan. No se deduplica por contenido.
6. **Concurrencia por bloqueo ordenado de filas** (participante → ticket → pago → pool_round) y
   `clock_timestamp()` evaluado *después* de adquirir los bloqueos para el lock horario. Respaldos por
   constraints únicas (un `payment_confirmed` por pago; un pago activo por ticket) para que un bug de
   lógica no pueda duplicar ingresos.
7. **Ledger append-only**: el ingreso se calcula exclusivamente con `SUM(ledger_entries.amount_minor)`
   dentro de RPC de reporte; nunca desde `payments.amount_minor`, valores del cliente ni contadores de UI.
   Las correcciones son asientos de reverso/ajuste; no hay UPDATE/DELETE (trigger + revocación).
8. **Autorización**: lectura propia para el participante; para el organizador mediante una única función
   `can_manage_pool_finance(tenant_id, pool_id)` (MVP: `owner`/`admin` activos del tenant; punto único
   para introducir administradores por quiniela sin reescribir políticas). Reembolsos, reversos y
   ajustes solo `owner`. Superadmin no hereda acceso (ADR-008 §9). El organizador no ve selecciones de un
   ticket antes de su lock (ADR-005): los listados administrativos excluyen selecciones hasta entonces.
9. **Pasarela futura**: `payments.provider`/`provider_ref` y un conjunto de estados ya compatibles; una
   pasarela solo podrá confirmar mediante un webhook verificado (Edge Function con firma) que invoque la
   misma RPC interna de confirmación. Requiere ADR propio (proveedor, SDK, dinero real; AGENTS §12).
10. **Fase y secuencia**: `pool_rounds` en Fase 06; tickets y selecciones en Fase 07; elegibilidad en
    ranking en Fase 08; payments/ledger/ingresos en una **fase comercial** posterior (no MVP actual).

## Contradicciones detectadas y resolución propuesta

| # | Contradicción | Resolución |
| --- | --- | --- |
| C1 | `predictions` único por `(participant_id, pool_match_id)` impide varios tickets por jornada. | Índices únicos parciales + `ticket_id` nullable (decisión 3). Aditivo, sin reescribir datos. |
| C2 | `save_prediction(pool, match, scores)` (Fase 03) opera sin ticket. | Se mantiene para `ticketing_mode='none'`; en `'tickets'` rechaza (`42501`). Una sola vía por pool. |
| C3 | `participants.payment_status` (`paid/pending/invited`) vs. pagos por ticket. | Sigue siendo estado informativo de membresía (Fase 05). En pools con tickets **no es fuente de ingresos** (ya advertido en `AMPLIACION-QUINIELAS-ROLES-INGRESOS.md`). No se elimina; se documenta su semántica. |
| C4 | AGENTS §3 limita el MVP a «estado manual de pago»; un ledger con importes excede ese alcance y AGENTS §12 exige ADR para dinero real. | El ledger registra pagos manuales; no procesa dinero. Se propone aprobarlo como **fase comercial** explícita (decisión D1). Hasta entonces solo se implementa Fase 06–07 sin payments/ledger. |
| C5 | ADR-005 oculta pronósticos ajenos hasta el lock, pero el organizador necesita ver tickets. | El organizador ve ticket/pago/estado; las selecciones solo desde `lock_at` por partido (misma regla que cualquier participante autorizado). |
| C6 | Legacy usa pronóstico 1X2 (`L/E/V`); `pool_rules` actual puntúa marcador exacto y resultado. | Se conserva marcador exacto (1X2 se deriva). Cambiarlo es decisión D2 y alteraría ADR-003/Fase 08. |
| C7 | ADR-011 y `save_prediction` comparan con `now()` (inicio de transacción); una transacción que espera un bloqueo podría validar con hora vieja. | Extensión, no ruptura: en RPC de tickets se usa `clock_timestamp()` tras bloquear. Se propone aplicar lo mismo a `save_prediction` en Fase 07. |
| C8 | Roles actuales solo `owner/admin/member`; el requisito 3 pide administrar «solo las quinielas autorizadas». | El MVP autoriza por tenant. Un tenant con dos admins comparte ingresos entre ambos (decisión D7); `can_manage_pool_finance` deja el punto de extensión. |

## Alternativas consideradas

- **Tabla `ticket_selections` separada**: rechazada; duplica lock/visibilidad, obliga a reescribir `scoring_events` (FK a `predictions`) y la Fase 08.
- **Estado único de ticket con valores de pago** (como legacy): rechazada; viola el requisito de separación y reabre ambigüedad de «vendido».
- **Ingresos como columna/contador en `tickets` o `pools`**: rechazada; no auditable ni reversible, riesgo de doble conteo.
- **Deduplicar por contenido de selecciones**: rechazada; bloquea compras legítimas idénticas.
- **Idempotencia solo en cliente**: rechazada; no cubre reintentos de red ni doble toque.
- **Escribir directamente con RLS (sin RPC)**: rechazada; RLS no expresa transiciones, cuotas ni atomicidad multi-tabla.
- **Ranking/ingresos materializados desde el inicio**: diferido; sin benchmark no se justifica (ADR-005). Se define umbral de revisión en el anexo §9.

## Consecuencias

- Aditivo sobre Fase 03: nuevas tablas, una columna nullable en `predictions` y `pool_matches.round_id`, una columna en `pools`, índices parciales. Sin reescritura de datos.
- Las vistas de Fase 07 (tickets) y la comercial (ingresos) no pueden «completarse» solo con UI; sus criterios de aceptación exigen pruebas SQL y de concurrencia (anexo §11).
- Los registros financieros no se borran: archivar quinielas (`status='archived'`), no eliminarlas; el offboarding de tenants requiere runbook y posible ADR de retención.
- Costo: el punto caliente por `(pool, round)` (contador de `ticket_no`) serializa altas del mismo pool-jornada; se mide antes de afirmar capacidad.

## Seguridad / privacidad

Amenazas y controles en el anexo §8. Resumen: sin `tenant_id` del cliente en autorización; sin importes del
cliente; RLS + RPC + constraints compuestas como defensa en profundidad; sin credenciales de pago
(baseline); `provider_ref`/referencia manual limitada a 64 caracteres y marcada como dato potencialmente
personal; auditoría en `audit_log` sin JWT ni PII adicional; códigos públicos de ticket aleatorios (no
secuenciales); límites por actor contra abuso.

## Migración / rollback

Plan por etapas, forward-only (anexo §10): M1 `pool_rounds` (Fase 06), M2 tickets + selecciones + RPC
(Fase 07), M3 elegibilidad en ranking (Fase 08), M4–M5 payments/ledger/reportes (fase comercial). Rollback
funcional: revocar `EXECUTE` de las RPC y volver `ticketing_mode` a `none`; **nunca** borrar ledger.
`DROP` solo es admisible antes del primer dato financiero real, con aprobación explícita.

## Decisiones pendientes de aprobación

D1 fase comercial y alcance de dinero registrado · D2 formato de pronóstico (marcador exacto vs 1X2) ·
D3 máximo de tickets por participante/jornada · D4 moneda y precio por jornada (precio 0 permitido) ·
D5 cierre de ventas = primer lock de la jornada · D6 tickets sin pago al cierre y confirmación tardía ·
D7 alcance financiero por quiniela y roles para reembolso/ajuste, bloqueo de autoconfirmación ·
D8 unidad del ranking (por ticket / mejor ticket / suma) · D9 definición de ingresos
(bruto/devoluciones/neto cobrado; sin «utilidad») · D10 reembolso como registro, no como movimiento de dinero ·
D11 límites del plan Free sobre tickets · D12 inmutabilidad de `audit_log` · D13 retención/offboarding.
Detalle y recomendación de cada una en el anexo §12.
