# ADR-015 — Integridad de la quiniela: lock inmutable, privilegios mínimos e incompatibilidad administrador/participante

- Estado: Proposed
- Fecha: 2026-10-11
- Decisores: Architecture, con Security, Data, Backend y Product. La regla de producto de la sección 2 está **aprobada**; el diseño sigue `Proposed`.
- Evidencia: [`reports/security/qa-readonly-audit-20261011.md`](../../../reports/security/qa-readonly-audit-20261011.md) (H1–H10).
- Relacionados: ADR-002, 005, 008, 011, 012, [ADR-014](ADR-014-multi-tenant-tickets-payments-and-ledger.md) (que delega aquí la gobernanza de la quiniela).

> Solo diseño. No autoriza migraciones, cambios de RLS/grants ni despliegues. La numeración de migraciones y fases es propuesta.

## 1. Contexto

La auditoría de solo lectura sobre QA confirmó que un organizador que también participa puede reabrir el lock, ver
pronósticos ajenos antes de tiempo, pronosticar con el resultado conocido o borrar predicciones ajenas (H1, H2), sin
rastro (H3). La causa raíz es doble: el lock depende de columnas mutables por el administrador, y **el mismo actor puede
administrar y competir**. Este ADR corrige ambas. **La regla de incompatibilidad no sustituye la remediación H1–H6; la
complementa** (cubre también cuentas cómplices solo en parte, ver §9).

## 2. Regla de producto aprobada — incompatibilidad administrador/participante

Definiciones (por quiniela `P` de un tenant `T`):

- **Capacidad administrativa sobre `P`** `Adm(P)`: perfil con rol `owner` o `admin` activo en `T` (el modelo vigente
  es tenant-level, por lo que cubre todas las quinielas de `T`) **o** fila activa de `pool_staff` de `P` con cualquier rol
  (`pool_owner`, `pool_manager`, `pool_finance`, ADR-014 D16 y los que se añadan). `member` no es capacidad administrativa.
- **Participación en `P`**: cualquier fila de `participants` de `P` (`pending`, `approved` o `withdrawn`), cualquier
  ticket y cualquier predicción, o aparecer en ranking.
- **Apertura**: instante `pools.opened_at` en que `P` pasa por primera vez a `open`. Antes de la apertura no hay competición.

**Regla.** Para toda quiniela `P`:

1. Un perfil con capacidad administrativa sobre `P` **no puede** inscribirse, emitir tickets, registrar pronósticos ni
   figurar en el ranking de `P`.
2. **Incompatibilidad histórica (permanente por quiniela):** quien haya tenido capacidad administrativa sobre `P`
   **en cualquier momento posterior a `opened_at`** queda excluido de participar en `P` para siempre, aunque ya no
   tenga el rol. Quitar temporalmente el rol no la levanta. Tener el rol solo mientras `P` estaba en borrador **no** la genera.
3. **Inverso:** no se concede capacidad administrativa sobre `P` a quien tenga participación en `P` mientras no se resuelva
   (§5). Tras el **primer lock** de `P` esa resolución ya no es posible: quien participó en `P` no administra `P` jamás.
4. Todo lo anterior solo afecta a `P`: el mismo perfil puede participar en cualquier otra quiniela donde no haya
   tenido capacidad administrativa, y administrar otras donde no participe.
5. La incompatibilidad se impone en el **servidor/base de datos**; la UI solo la refleja. No existe excepción ni
   anulación por Superadmin (ADR-008 §9).

Consecuencia con el modelo actual: mientras la administración sea tenant-level, un `owner`/`admin` del tenant queda
excluido de **todas** las quinielas de ese tenant (decisión D17).

## 3. Flujos afectados

| Flujo | Cambio |
| --- | --- |
| `join_pool` (Fase 04) | Rechaza si el llamante está en `Adm(P)` o en `pool_admin_exclusions(P)`; mensaje uniforme `42501` «incompatible» sin revelar a terceros |
| `approve_participant`, `set_participant_payment_status` (Fase 05) | Rechazan sobre un participante incompatible (datos heredados) |
| `create_ticket`, `save_ticket_selections`, `submit_ticket` (ADR-014) | Precondición de incompatibilidad |
| `save_prediction` (Fase 03) | Precondición de incompatibilidad |
| Alta/cambio de rol en `tenant_memberships` (owner/admin) | Rechaza si el perfil participa en alguna quiniela del tenant ya abierta; si no, escribe exclusiones |
| Alta en `pool_staff` / transferencia de administración | Rechaza si hay participación en `P`; escribe exclusión |
| Ranking / elegibilidad (Fase 08, ADR-014) | Excluyen toda fila incompatible aunque exista (defensa para datos heredados) |
| `withdraw_participation` (nuevo) | Único camino para resolver una participación antes de administrar |
| `transfer_pool_administration` (nuevo) | Único camino para cambiar de administrador de forma auditada |
| Planes/límites Free | El administrador no cuenta como participante |

## 4. Controles de backend

**Modelo (propuesta).**
- `pools.opened_at timestamptz` (se fija una vez al primer `open`, inmutable por trigger).
- `pool_admin_exclusions(tenant_id, pool_id, profile_id, since timestamptz, source text, primary key (pool_id, profile_id))`,
  FK compuestas a `pools` y `profiles`, **append-only** (mismo endurecimiento que `audit_log`: triggers por fila y por
  sentencia, `REVOKE ALL`, sin `TRUNCATE`). Escrita solo por triggers/RPC internas.
- `participants.withdrawn_at timestamptz null` y `withdrawn_by` (no se borra la fila; ADR-014 exige `RESTRICT`).
- Función `can_admin_pool(tenant_id, pool_id, profile_id) → boolean` (`STABLE SECURITY DEFINER`, `search_path = ''`):
  `Adm(P)` actual. Función `is_pool_excluded(pool_id, profile_id)` = `Adm(P)` **o** fila en exclusiones.

**Triggers (autoritativos; aplican también a `service_role` y owner de tabla).**
1. `BEFORE INSERT OR UPDATE ON participants`: si `is_pool_excluded` → `42501`. (Cubre `join_pool`, SQL directo, seeds.)
2. `BEFORE INSERT ON tickets` y `BEFORE INSERT OR UPDATE ON predictions`: ídem.
3. `BEFORE INSERT OR UPDATE OF role, is_active ON tenant_memberships` (hacia owner/admin activo) y
   `BEFORE INSERT OR UPDATE ON pool_staff`: si el perfil tiene fila en `participants` de alguna quiniela afectada que ya
   se abrió, o participó antes de su primer lock → `42501`. En caso contrario **escribe exclusiones** para las quinielas ya abiertas.
4. `AFTER UPDATE OF status ON pools` (primera apertura): fija `opened_at` y **snapshot** de exclusiones con todo `Adm(P)` vigente.
5. Rechazo de participación en una quiniela cuyo `Adm(P)` incluye al perfil por un cambio concurrente: ver concurrencia.

**Concurrencia.** Las dos operaciones que pueden cruzarse (inscripción/ticket/pronóstico y concesión de rol) toman el
**mismo bloqueo asesor transaccional** `pg_advisory_xact_lock(k1, hashtextextended(pool_id || profile_id, 0))` antes de
comprobar y escribir; una concesión de rol tenant-level adquiere los bloqueos de todas las quinielas afectadas en
**orden ascendente de `pool_id`** (sin deadlocks). Tras el bloqueo, en READ COMMITTED cada lado ve lo ya confirmado por
el otro; si ambos son concurrentes, uno espera y el segundo falla con `42501`. El estado final nunca tiene al mismo perfil en
`Adm(P)` y en participación. Respaldo: la comprobación de lectura (ranking/elegibilidad) y un reporte de conciliación.

**Datos heredados.** Antes de activar los triggers: consulta de **detección** de conflictos (sin borrar nada). QA ya incluye
conflictos (el seed hace participante al `owner` del Tenant A). Tratamiento propuesto (D18): marcar, excluir de ranking y
tickets elegibles, informar al organizador; no borrar. El seed de pruebas se corrige.

**Auditoría.** Se escribe en `audit_log` (inmutable, R3) cada concesión/revocación de capacidad, transferencia,
retirada de participación y alta de exclusión (actor, acción, entidad, valores permitidos; sin PII). Un intento
rechazado hace *rollback* y no puede escribir en la misma transacción: se registra con un contador/log de la capa API
(limitación documentada).

## 5. Procedimientos seguros

**Retirar la participación** (`withdraw_participation(pool_id)`, solo antes del **primer lock** de `P`): el participante
queda `withdrawn`; sus tickets pasan a `cancelled` con la regla de reembolso registrado de ADR-014; sus predicciones se
conservan pero **no puntúan ni figuran** en ranking; no se borra nada. Tras el primer lock no existe retirada que habilite administrar.
Mientras la quiniela esté en `draft` un perfil puede administrar y, si lo desea, dejar el rol y participar: no hay exclusión.

**Conceder administración a un participante existente:** `assign_pool_staff` / alta de rol rechaza con un error que indica
«retire primero su participación» si `P` aún no tuvo su primer lock; después de él, rechaza sin camino de resolución.

**Transferir o abandonar la administración** (`transfer_pool_administration(pool_id, new_profile_id)`), en una
transacción: (1) el actor es `pool_owner` o `owner` del tenant; (2) el destinatario no tiene participación ni exclusión en `P`;
(3) se bloquean los perfiles saliente y entrante (orden fijo) y la quiniela; (4) se concede la capacidad al nuevo; (5) se
revoca la del saliente solo si queda al menos un `pool_owner`; (6) el saliente **permanece** en `pool_admin_exclusions` (si
`P` ya abrió); (7) `audit_log`. Si una cuenta quiere participar en `P` tras dejar el cargo y `P` ya abrió, no puede: debe
participar en otra quiniela. La transferencia después del primer resultado oficial exige segundo aprobador (ADR-014 D6/§2).

## 6. Matriz de permisos (resumen)

| Acción en `P` | Participante | `pool_finance` | `pool_manager` | `pool_owner` / owner,admin tenant | Superadmin |
| --- | --- | --- | --- | --- | --- |
| Inscribirse / ticket / pronóstico | ✔ (si no excluido) | ✘ | ✘ | ✘ | ✘ (sin acceso implícito) |
| Ver ranking propio | ✔ | n/a | n/a | n/a | n/a |
| Ver tickets/pagos de `P` | solo propios | ✔ | ✔ (sin finanzas) | ✔ | ✘ |
| Confirmar pago | ✘ | ✔ | ✘ | ✔ | ✘ |
| Reembolso/ajuste/reverso | ✘ | ✘ | ✘ | ✔ (solo owner) | ✘ |
| Programar partidos / editar lock | ✘ | ✘ | ✔ (RPC, congelado tras lock) | ✔ | ✘ |
| Conceder/transferir capacidad | ✘ | ✘ | ✘ | ✔ | ✘ |
| Participar en **otra** quiniela | ✔ | ✔ | ✔ | ✔ | ✔ |

La columna «administrar» equivale a pertenecer a `Adm(P)`; ADR-014 §8 (`pool_staff`) queda subordinado a esta matriz.

## 7. Remediación H1–H6 (se mantiene íntegra; no se reabre aquí)

Se adoptan R1–R6 del informe de auditoría (§6): triggers de congelación de lock/horario/borrado (R1), revocación de
`TRUNCATE/REFERENCES/TRIGGER` y de DML a `anon` y de `EXECUTE` a `PUBLIC/anon` (R2), `audit_log` inmutable (R3), auditoría
de acciones administrativas (R4), `pool_join_codes` solo administrador (R5), bloqueo de quiniela en `join_pool` (R6).
Siguen siendo necesarias porque la incompatibilidad no protege de: una cuenta cómplice, de un organizador que manipula
horarios sin participar para favorecer a un tercero, ni de la alteración de resultados.

## 8. Casos de prueba (negativos y concurrentes)

Suites futuras `supabase/tests/phase-0x-admin-participant-incompat.sql` y `scripts/qa/incompat-concurrency.sh`.

| ID | Caso | Resultado esperado |
| --- | --- | --- |
| INC-01 | `owner`/`admin` del tenant ejecuta `join_pool` de una quiniela del tenant | `42501` |
| INC-02 | `pool_manager`/`pool_finance`/`pool_owner` intenta inscribirse | `42501` |
| INC-03 | Mismo usuario se inscribe en quiniela de otro tenant o en otra sin rol | ✔ permitido |
| INC-04 | Administrador crea ticket / `save_ticket_selections` / `save_prediction` (incl. SQL directo y `service_role`) | `42501`; 0 filas |
| INC-05 | Administrador figura en ranking (dato heredado) | excluido de vista/elegibilidad |
| INC-06 | Conceder `admin` a un participante tras el primer lock | `42501`, sin camino de resolución |
| INC-07 | Idem antes del primer lock con participación activa | `42501` con indicación de retirar |
| INC-08 | `withdraw_participation` antes del primer lock, luego conceder rol | ✔; tickets cancelados; predicciones no puntúan |
| INC-09 | `withdraw_participation` tras el primer lock | rechazo |
| INC-10 | Admin con `P` abierta pierde el rol y luego `join_pool` | `42501` (exclusión histórica) |
| INC-11 | Admin con `P` en borrador pierde el rol y luego se inscribe tras abrir | ✔ |
| INC-12 | Rol re-otorgado/retirado en bucle, luego inscripción | siempre `42501` |
| INC-13 | `transfer_pool_administration` a un participante, o dejando la quiniela sin `pool_owner` | rechazo |
| INC-14 | Transferencia válida: saliente pasa a excluido, entrante administra, 2 filas de `audit_log` | ✔ |
| INC-15 | Cambio de rol del tenant a `admin` de alguien que participa en una quiniela abierta del tenant | `42501` |
| INC-16 | Aislamiento: exclusión en `P1` no afecta a `P2`; tenant A no ve exclusiones del tenant B | ✔ / `42501` |
| INC-17 | UPDATE/DELETE/TRUNCATE de `pool_admin_exclusions` por cualquier rol | rechazo |
| INC-C1 | 50 repeticiones: `join_pool` y concesión de rol simultáneos para el mismo `(P, perfil)` | exactamente uno triunfa; nunca ambos |
| INC-C2 | Rol tenant-level concedido mientras el perfil se inscribe en 2 quinielas | sin deadlock; estado final consistente |
| INC-C3 | 20 `create_ticket` simultáneos de un administrador recién promovido | 0 tickets |
| INC-C4 | Transferencias simultáneas contra la misma quiniela | serializadas; siempre ≥ 1 `pool_owner` |

## 9. Riesgo residual

Una persona con dos cuentas (una administrativa, otra participante) no es detectable por la base de datos; controles
compensatorios: H1–H6 (el administrador no puede manipular lock/horarios/resultados sin rastro), transparencia hacia
participantes, reporte de anomalías (coincidencias de dispositivo/pago fuera de alcance MVP) y verificación de identidad
solo si el producto lo decide (fuera de este ADR).

## 10. Alternativas consideradas

- Solo UI: rechazada (RLS/RPC/DB son la frontera, AGENTS §5).
- Incompatibilidad solo vigente mientras dura el rol: rechazada (permite «quitar rol → manipular → participar»).
- Incompatibilidad por tenant o torneo: rechazada; la regla aprobada es por quiniela.
- `EXCLUDE`/restricción única entre tablas: no expresable entre `participants` y roles; se usan triggers + bloqueo asesor.
- Serializable globalmente: rechazada por coste; el bloqueo por `(pool, perfil)` es acotado.
- Bloqueo por fila de `pools`: serializaría toda la quiniela; se prefiere granularidad `(pool, perfil)`.

## 11. Consecuencias y decisiones pendientes

- Cambia **autorización** (AGENTS §12): por eso este ADR. Añade tablas/columnas aditivas y triggers; no cambia firmas de RPC existentes.
- Afecta Fases 03–05 (RPC y seed) y condiciona 06–08 (ver §12). ADR-014 pierde la decisión D14 (autoconfirmación): queda
  resuelta por esta regla (misma cuenta imposible); solo permanece el riesgo de §9.
- **Decisiones pendientes** (no afectan a la regla): **D17** mientras la administración sea tenant-level, ¿se acepta que
  `owner`/`admin` queden excluidos de todas las quinielas del tenant (recomendado) o se adelanta la administración por quiniela? ·
  **D18** tratamiento de conflictos heredados (marcar y excluir, recomendado) · **D19** confirmar `opened_at` como inicio
  de la incompatibilidad histórica y la retirada de participación hasta el primer lock · **D20** confirmar que no hay
  excepción ni override (ni Superadmin).

## 12. Fases, orden y criterios de aceptación

Orden: **(1)** R1–R6 de H1–H6 → **(2)** incompatibilidad (§4) → resto del plan de ADR-014. Ambos antes de abrir quinielas al público.

| Fase | Entrega / criterio |
| --- | --- |
| 03–05 (hardening, antes de Fase 06) | R1–R6; `opened_at`, exclusiones, triggers de participación y de roles; `join_pool`/`approve_participant` actualizados; seed corregido; INC-01–INC-05, 10–12, 15–17, C1–C2 PASS |
| 06 | `manage_schedule`; transferencia (`transfer_pool_administration`) y `pool_staff` mínimo; INC-13/14/C4 |
| 07 | tickets y predicciones con precondición; `withdraw_participation`; INC-04/06–09/C3 |
| 08 | ranking y elegibilidad excluyen incompatibles; INC-05 sobre dataset con datos heredados |
| Comercial | confirmaciones/reembolsos respetan la matriz §6; auditoría de eventos de gobernanza |

**Criterios para aceptar ADR-015:** re-revisión Security/Data sin hallazgos críticos/altos; DDL conceptual probado en base
descartable (incl. bloqueo asesor y orden de bloqueos); INC-01–C4 con casos nombrados y ejecutados en base descartable;
conciliación de conflictos heredados descrita; reproducción H1/H2 ejecutada y corregida (autorización pendiente);
D17–D20 cerradas; evidencia de privilegios (`has_table_privilege`) adjunta; aprobación explícita del usuario.
