# ADR-032 — Observabilidad y métricas de crecimiento para Superadmin

- Estado: Accepted
- Fecha: 2026-10-26
- Decisor: Propietario del producto

## Decisión

La plataforma registra presencia autenticada de corta vida y eventos de error de cliente anonimizados. El Superadmin
consulta usuarios en línea, actividad agregada por usuario, errores recientes y KPIs de crecimiento a través de RPCs
protegidas por `platform_console_guard()`.

## Protección de datos

No se guardan correos de Auth, IP, tokens, códigos de invitación, trazas, payloads ni secretos. La presencia solo
conserva perfil, ruta sin query/hash y último heartbeat. El navegador sanitiza los eventos antes de enviarlos y la
base aplica un filtro adicional para correo. Las tablas no tienen `GRANT` ni política cliente; solo las RPCs concedidas
son accesibles.

## Métricas

Las métricas responden a preguntas de negocio verificables: actividad actual/24h, altas de usuarios, nuevos clientes,
solicitudes de plan y errores. No se presenta conversión, ingresos o tendencias inventadas cuando no existe una fuente
de datos de negocio que las soporte.
