# ADR-014 — Tickets multi-tenant, pagos manuales y libro financiero append-only

- Estado: Proposed
- Fecha: 2026-10-11
- Decisores: Architecture (preparación de tickets). Requiere aprobación del Product Owner (sección «Decisiones pendientes»).
- Detalle técnico (DDL conceptual, RPC, RLS, pruebas): [`ADR-014-ANNEX-tickets-technical-design.md`](../ADR-014-ANNEX-tickets-technical-design.md)
- Revisión 2 (Security, Data, Backend, Product): [`ADR-014-REVIEW-20261011.md`](../ADR-014-REVIEW-20261011.md) — **este texto la incorpora; prevalece sobre el anexo donde difieran**.
- Gobernanza, lock inmutable e incompatibilidad administrador/participante: [`ADR-015`](ADR-015-pool-integrity-and-admin-participant-incompatibility.md) (**precondición** de este ADR).
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
8. **Autorización por quiniela (D7, aprobada)**: nueva tabla `pool_staff(tenant_id, pool_id, profile_id, role,
   is_active)` con FK compuestas a `pools` y `tenant_memberships`; roles propuestos `pool_owner`, `pool_manager`,
   `pool_finance` (D16). Toda lectura/escritura de tickets, pagos e ingresos pasa por
   `can_manage_pool_finance(tenant_id, pool_id, capability)`, que exige fila activa en `pool_staff`; **ser admin
   del tenant no basta**. Solo el `owner` del tenant asigna personal, con auditoría; el creador de la quiniela queda
   asignado. Reembolsos, reversos y ajustes: capacidad separada. Superadmin no hereda acceso (ADR-008 §9). El
   organizador no ve selecciones de un ticket antes de su lock (ADR-005). Las funciones de Fase 05 basadas en
   `is_tenant_admin` no cambian aquí; **toda capacidad de `pool_staff` es capacidad administrativa y es incompatible con
   participar, comprar tickets o figurar en ranking de la misma quiniela (ADR-015 §2)**; migrar toda la administración a alcance por quiniela requiere un ADR aparte.
9. **Pasarela futura**: `payments.provider`/`provider_ref` y un conjunto de estados ya compatibles; una
   pasarela solo podrá confirmar mediante un webhook verificado (Edge Function con firma) que invoque la
   misma RPC interna de confirmación. Requiere ADR propio (proveedor, SDK, dinero real; AGENTS §12).
10. **Elegibilidad congelada (D6 rediseñada)**: la elegibilidad de un ticket para ranking **no se lee del pago
    en vivo**; es el campo `tickets.eligibility` (`pending` → `eligible` | `ineligible`), escrito solo por RPC. Al
    cierre efectivo (primer lock de la jornada, D5) una operación idempotente `seal_round_sales` lo fija: `eligible`
    si el pago estaba `confirmed` con `confirmed_at` (reloj del servidor, nunca parámetro) ≤ cierre; `ineligible` en
    otro caso. Tras el sello, cancelar, rechazar, reversar o confirmar **no altera la elegibilidad**. Gracia
    opcional por jornada (D6-b), solo `owner`, con segunda aprobación visible a participantes, y **nunca después del
    primer `official_result` de la jornada** (comprobado por la base de datos). Antes del sello, un único organizador
    puede confirmar: aún no existe información sobre resultados que explotar. Un reembolso posterior es un asiento
    financiero; el ticket conserva su elegibilidad.
11. **Precondiciones de endurecimiento (defectos existentes de Fase 03; bloquean M2)**:
    P1 el admin hoy puede cambiar `lock_offset`, `starts_at` y `pool_matches` por DML directo (F03:124,130-131,137) y
    así reabrir locks o leer pronósticos ajenos antes de tiempo → revocar DML directo, escribir solo por RPC
    (`manage_schedule`, ADR-011) y triggers que impidan adelantar `lock_at`, mover partidos o cambiar `pool_matches`
    con predicciones/tickets, también al owner de tabla; P3 `audit_log` y `ledger_entries` realmente inmutables
    (trigger por fila y por sentencia incl. `TRUNCATE`, `REVOKE ALL`, `FORCE RLS`; verificar privilegios efectivos);
    P4 migración **atómica** de la unicidad de `predictions` junto con `CREATE OR REPLACE save_prediction`
    (`ON CONFLICT … WHERE ticket_id IS NULL`, guarda por `ticketing_mode`), porque el `ON CONFLICT` actual
    (F03:108) falla con `42P10` si solo se cambia el índice; P5 **reemplazar** (no añadir) las FK en cascada de
    `predictions`, `pool_matches`, `participants` y `scoring_events` por `RESTRICT`; `ticketing_mode` solo
    `none→tickets` y solo si el pool no tiene predicciones.
12. **Numeración gap-tolerant**: `ticket_no` por secuencia, sin contador por pool-jornada; la numeración visible
    se deriva. Un correlativo estricto solo se adopta si producto lo exige y tras benchmark.
13. **Regla de incompatibilidad (aprobada, ADR-015)**: `create_ticket`, `save_ticket_selections` y `submit_ticket` rechazan
    a quien tenga capacidad administrativa actual o histórica sobre el pool; `eligibility` y el ranking excluyen a esos perfiles.
    Esto elimina la autoconfirmación con la misma cuenta (D14 resuelta); `confirm_payment` ya no necesita comprobarla.
14. **Fase y secuencia (D1, aprobada)**: `pool_rounds` y P1/P5 en Fase 06; `pool_staff`, tickets (solo precio 0),
    selecciones y P4 en Fase 07; elegibilidad y ranking en Fase 08; payments, ledger, sello e ingresos en una
    **fase comercial posterior a la 07**, inicialmente con pagos manuales y sin procesamiento de dinero.

## Contradicciones detectadas y resolución propuesta

| # | Contradicción | Resolución |
| --- | --- | --- |
| C1 | `predictions` único por `(participant_id, pool_match_id)` impide varios tickets por jornada. | Índices únicos parciales + `ticket_id` nullable (decisión 3). Aditivo, sin reescribir datos. |
| C2 | `save_prediction` (Fase 03) opera sin ticket y su `ON CONFLICT` depende de la unicidad actual. | Se mantiene para `ticketing_mode='none'` y rechaza en `'tickets'` (`42501`); su `ON CONFLICT` se reescribe en la misma migración que cambia la unicidad (P4). |
| C3 | `participants.payment_status` (`paid/pending/invited`) vs. pagos por ticket. | Sigue siendo estado informativo de membresía (Fase 05). En pools con tickets **no es fuente de ingresos** (ya advertido en `AMPLIACION-QUINIELAS-ROLES-INGRESOS.md`). No se elimina; se documenta su semántica. |
| C4 | AGENTS §3 limita el MVP a «estado manual de pago»; un ledger con importes excede ese alcance y AGENTS §12 exige ADR para dinero real. | El ledger registra pagos manuales; no procesa dinero. Se propone aprobarlo como **fase comercial** explícita (decisión D1). Hasta entonces solo se implementa Fase 06–07 sin payments/ledger. |
| C5 | ADR-005 oculta pronósticos ajenos hasta el lock, pero el organizador necesita ver tickets. | El organizador ve ticket/pago/estado; las selecciones solo desde `lock_at` por partido (misma regla que cualquier participante autorizado). |
| C6 | Legacy usa pronóstico 1X2 (`L/E/V`); `pool_rules` actual puntúa marcador exacto y resultado. | Se conserva marcador exacto (1X2 se deriva). Cambiarlo es decisión D2 y alteraría ADR-003/Fase 08. |
| C7 | ADR-011 y `save_prediction` comparan con `now()` (inicio de transacción); una transacción que espera un bloqueo podría validar con hora vieja. | Extensión, no ruptura: en RPC de tickets se usa `clock_timestamp()` tras bloquear. Se propone aplicar lo mismo a `save_prediction` en Fase 07. |
| C8 | Roles actuales solo `owner/admin/member`; D7 exige autorización por quiniela. | `pool_staff` + `can_manage_pool_finance` por capacidad (decisión 8). |
| C9 | ADR-005/011 afirman que el lock no puede reabrirse, pero el admin tiene DML directo sobre `pools`, `matches` y `pool_matches`. | Precondición P1 (decisión 11). Defecto existente, anterior a este ADR. |
| C11 | Un organizador podía participar y competir en su propia quiniela (el seed lo hace). | ADR-015: incompatibilidad actual e histórica, impuesta en DB. Ranking/tickets excluyen incompatibles. |
| C10 | Las FK de Fase 03 son `ON DELETE CASCADE`; los registros financieros exigen `RESTRICT`. | Reemplazar las FK (P5); archivar en lugar de borrar. |

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

Plan por etapas, forward-only (revisión §6; sustituye al anexo §10): Fase 06 = P1/P5 + `pool_rounds`; Fase 07 = `pool_staff`,
tickets, P4; Fase 08 = elegibilidad y ranking; fase comercial = P3, payments, ledger, sello, ingresos. Rollback
funcional: revocar `EXECUTE` de las RPC y volver `ticketing_mode` a `none`; **nunca** borrar ledger.
`DROP` solo es admisible antes del primer dato financiero real, con aprobación explícita.

## Decisiones de producto

Aprobadas por el usuario: **D1** fase comercial posterior a la 07 con pagos manuales · **D2** marcador exacto,
conservando extensibilidad (el tipo de pronóstico no se codifica en el esquema de tickets) · **D3** máximo por
quiniela, 1 por defecto · **D4** moneda por quiniela (`pools.currency`, inmutable tras el primer ticket), precio
por jornada, gratis admitido · **D5** cierre antes del primer bloqueo · **D7** autorización por quiniela ·
**D9** cobrado bruto / devoluciones / cobrado neto, sin «utilidad» · **D10** reembolso externo solo registrado y
auditado · **D12** auditoría inmutable (ver P3).
Aprobadas con diseño propuesto y detalle abierto: **D6-b** gracia de confirmación tardía · **D8** regla de «mejor
ticket válido» · **D11** límites Free por capacidad/coste/modelo (sin números; procedimiento en la revisión) ·
**D13** retención y baja. Nuevas: **D14** resuelta por ADR-015 · **D15** cadena de hash
del ledger · **D16** roles de `pool_staff`. Criterios para aceptar el ADR: revisión §7 (A1–A9).
