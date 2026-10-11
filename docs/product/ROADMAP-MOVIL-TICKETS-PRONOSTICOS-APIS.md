# Extensión funcional móvil — roles, tickets, equipos y pronósticos

Estado: **Propuesta / preparación**, sin autorización para cambiar el esquema de producción ni las fases 06–08. Las vistas de organizador y puntos pueden existir antes de contar con datos transaccionales.

## Experiencias diferenciadas
- **Participante:** inicio, ligas, partidos, pronósticos, tickets propios, puntos/rankings por liga y perfil.
- **Organizador:** acceso exclusivo por membresía activa con rol autorizado, selector de organización, ligas administradas, participantes, reglas, jornadas, tickets/ventas e ingresos.
- Una persona puede alternar modos; **la intención declarada durante registro no otorga roles**. Superadmin es un límite de autoridad independiente.
- En móvil usar navegación resumida y accesos contextuales; evitar menús de más de cinco opciones inferiores.

## Aislamiento de tickets y escalabilidad concurrente
1. Modelo propuesto: `ticket(id, tenant_id, pool_id, round_id, participant_profile_id, status, created_at, ...)`, `ticket_selection(ticket_id, match_id, prediction, ...)`, `ticket_payment_event(id, tenant_id, ticket_id, amount_minor, currency, source_ref, event_kind, confirmed_at, ...)`. Alinear nombres con el modelo finalmente aprobado.
2. Claves foráneas y restricciones compuestas para garantizar que ticket, liga, jornada y partido pertenecen al **mismo tenant**. No confiar jamás en `tenant_id` seleccionado en cliente.
3. RLS + RPC de servidor: lectura propia para participante; consultas del organizador **acotadas a tenants con membership administrativa activa**, y cuando proceda pool administrado; Superadmin con permisos explícitos por separado. Tests negativos entre dos administradores y dos tenants con tickets distintos.
4. `UNIQUE` e idempotency keys para compra y confirmación de pago; transacciones atómicas, control de carreras concurrentes y reintentos seguros. Prohibido marcar como pagado a partir del frontend. Evitar sumas en frontend para saldos oficiales.
5. Paginación server-side, índices (`tenant_id,pool_id,created_at`), agregaciones acotadas, límites de tasa, conexiones poolizadas, observabilidad sin PII, respaldo y pruebas concurrentes de varias sesiones. Ninguna afirmación de carga masiva sin benchmark.
6. Distinguir tickets emitidos, reservados, pendientes, confirmados, anulados y reembolsados. Ingresos brutos = pagos confirmados no revertidos según definición contable acordada; gastos, comisiones y neto deben tener fuentes verificables.

## Equipos dinámicos y APIs deportivas
- No fijar clubes en constantes del frontend: catálogo de equipos persistido, con nombre, deporte, región, fuente, `external_id` por proveedor, escudo con licencia verificada, estado activo y metadatos de sincronización.
- Importación por **worker/Edge Function del servidor**, nunca con API key en `VITE_`; deduplicación con identidad de proveedor y conciliación manual ante ambigüedad.
- Separar catálogo global de equipos de sus inscripciones a competiciones/temporadas y del fixture creado por organizadores.
- Adaptador intercambiable de proveedor: `listCompetitions`, `listTeams`, `listFixtures`, `getResults`, con normalización, paginación, cuotas, cache, backoff, límites de solicitudes y políticas de frescura.
- Resultados externos son candidatos; definir autoridad y revisión antes de publicar un resultado oficial que recalcule puntuaciones. Nunca sobrescribir cambios manuales confirmados automáticamente.
- Seleccionar proveedor, licencias de datos/escudos, costes y cobertura geográfica **antes** de integrar credenciales.

## Pronósticos
- Predicción individual ligada a usuario, ticket, partido y versión de reglas. Ventanas de envío y lock calculadas en el servidor según zona horaria/autoridad del fixture (ADR vigentes).
- RPC transaccional verifica membership, estado de pago cuando aplique, liga y partido; rechazo de modificación post-lock, anti-replay, idempotencia, protección de pronósticos ajenos antes del inicio.
- Scoring determinístico, versionado e idempotente por jornada con eventos auditables y recálculo tras revisión de resultados (Fases 07/08).
- Pantallas móviles: seleccionar resultados, revisar el ticket, confirmar envío, ver lock/pendientes/resultados/aciertos/puntos e historial por liga. Estados vacíos hasta que backend funcione; sin datos inventados.

## Secuencia de trabajo con sportleagues-dev
1. Cerrar aceptación 05/05-bis y evaluar ADR 009–012.
2. Aceptar contratos y modelo de Fase 06: catálogo/equipos dinámicos, fuentes API, fixture, jornadas, resultados.
3. Fase 07: predicciones y tickets con RLS/capacidades por liga y lock server-side.
4. Fase 08: scoring, puntos/ranking por liga.
5. Fase comercial específica propuesta: registro manual de pagos verificables, ledger de eventos financieros, ingresos de organizador y reconciliación; pagos online solo mediante autorización, si se incorpora posteriormente.
6. Pruebas E2E móviles 320/390/430, multi-tenant, sesiones simultáneas, concurrencia y pruebas de seguridad antes del release.

## Criterios mínimos de aceptación futuros
- Administrador A no ve ni puede alterar tickets, pagos, puntos o participantes de Administrador B (mismo y distinto tenant según contexto).
- El usuario observa únicamente tickets propios y sus puntos **por liga**.
- Dos solicitudes simultáneas idénticas no emiten dos pagos ni dos tickets, incluso con reintentos.
- Una API externa no puede cambiar el resultado oficial sin la política de revisión acordada.
- No existen importes simulados en dashboards reales ni claves privadas en el bundle.
- Ninguna sección se considera completada solo por su interfaz.
