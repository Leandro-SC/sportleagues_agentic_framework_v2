# Ampliación SportLeagues: referencia de quinielas, roles y dos ganancias

**Estado: propuesta de producto, no fase aceptada ni backend implementado.** Mantener `AGENTS.md` y ADR aceptados como autoridad. No sustituye el PRD.

## Experiencias

- **Participante:** ligas a las que pertenece, pronósticos, tickets, clasificación y **puntos por quiniela/jornada**. No existe un saldo financiero de participante.
- **Organizador:** administradores con membership autorizado; gestión de participantes y estado manual de pago, y a futuro **tickets, ventas e ingresos por quiniela/jornada**.
- **Superadmin:** privilegio de plataforma separado, nunca concedido por preferencia de registro.
- Una identidad puede participar en unas ligas y administrar otras. La selección inicial «quiero participar» / «quiero organizar» debe funcionar como intención de onboarding, **nunca** como autorización. Antes de implementarla plenamente, documentar flujo de creación de tenant/ligas y garantías anti-escalada.

## Inventario de fuente de referencia anterior

`Proyecto_Quiniela.zip` contiene referencias funcionales como `TicketService.php`, `TicketController.php`, `TicketAdminController.php`, `DashboardController.php`, `RankingService.php`, `RoundAdminController.php`, `RoundMatchesAdminController.php`, `PromotionAdminController.php` y `VerifierController.php`. No copiar código, configuraciones ni reglas de pagos sin auditoría; respetar licencias de imágenes/escudos. No incluir el ZIP heredado ni sus `.env`/`.git` en este repositorio.

## Estado real de la copia entregada

| Capacidad | Situación | Dependencia / acción |
| --- | --- | --- |
| Auth email/Google | Código existente | Ejecutar E2E manual antes de declarar listo |
| Admin tenant y participantes | Backend/RLS y vistas existentes | Cerrar gates 05 y 05-bis |
| Cambio de modo al registrarse | No implementado | Producto y onboarding; jamás crear admin por metadata |
| Puntos por quiniela | **Pantalla con ligas reales y estado pendiente** | Fases de fixture, pronósticos y scoring |
| Ingresos/tickets del organizador | **Pantalla con estado pendiente, guard de admin existente** | Modelo financiero, pagos verificados y auditoría; requiere ADR |
| Tickets de compra | No implementado | Separar ticket, pago, promoción, reembolso |
| Ranking, partidos y resultados | Funcionalidad por fases / UI preliminar | Fases 06–08 antes de mostrar cifras |

## Contrato funcional futuro de ticket e ingresos (no migrado)

- Cada ticket pertenece inequívocamente a tenant, pool, jornada y comprador; contiene selecciones y estado de bloqueo.
- Distinguir `created`, `pending`, `confirmed`, `rejected`, `cancelled`, `refunded` usando transiciones auditables.
- Un ticket creado o pendiente **no** es ingreso cobrado. Registrar fuente de confirmación confiable, referencia de transacción, moneda, importe en unidades mínimas, promociones, comisiones y reembolsos con idempotencia.
- Ingresos brutos = pagos confirmados válidos menos reembolsos según política acordada; definir claramente si «neto» resta comisiones, descuentos, impuestos y/o premios. No denominar utilidad a facturación.
- Estadísticas y exportaciones solo para memberships autorizados, con RLS, RPC y tests negativos cross-tenant/cross-pool.
- Decidir qué constituye venta si solo hay registro manual de pago; no asumir que cambiar el campo `participants.payment_status` es una transacción monetaria.
- Pagos online, retiros, apuestas y reparto de premios no están autorizados; evaluar normativa y alcance antes de implementar.

## Reglas de scoring

- Puntos no convertibles automáticamente en dinero.
- Cálculo en servidor, determinístico, idempotente y por versión de reglas.
- Mantener integridad del lock; los resultados revisados producen recálculo sin duplicidad.
- Evitar sumar clasificaciones de ligas con sistemas de puntuación diferentes.

## Próximas decisiones obligatorias

1. Cerrar 05/05-bis con happy paths HTTP y pruebas manuales.
2. Aceptar o resolver ADR 009–012 antes de implementar torneos y fixture.
3. Definir intención «organizador» y el proceso seguro de creación de tenant (ADR si cambia autorización).
4. Aprobar un modelo de ticket, estados y libro financiero con decisiones explícitas sobre monedas e ingresos netos (nuevo ADR).
5. Definir el origen de resultados/horarios de partidos, premios, promociones, impuestos y reportes.
6. Solo entonces crear migraciones con RLS, suites negativas, transacciones idempotentes y pruebas E2E.

## Cambios incluidos en esta entrega

- `/mis-puntos`: ruta protegida, ligas reales del usuario bajo RLS, sin puntos ficticios.
- `/admin/ingresos`: ruta protegida por el guard de `/admin`, selección de tenant autorizado, **sin totales inventados**.
- Navegación inferior añade «Puntos»; Perfil incluye acceso a sus puntos; panel de administrador enlaza a ingresos.
- Tests de navegación y rutas actualizados. Ninguna migración, alteración de RLS, pago ni integración de proveedor externo.
