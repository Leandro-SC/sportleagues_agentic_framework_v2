# ADR-028 — Consola aislada de Superadministración

- Estado: **Accepted** (2026-10-24, instrucción del propietario).
- Complementa ADR-008 y materializa ADR-018 fuera de la aplicación de jugadores.

## Decisión

La consola vive como aplicación Vite independiente en `apps/superadmin`, con su propio origen y variables de despliegue. No se registra en el router, menú ni bundle de `apps/platform`.

La sesión usa la clave anónima de Supabase, pero cada lectura o mutación global pasa por una RPC `security definer` que exige `is_platform_admin()`. No habrá clave `service_role`, acceso directo global a tablas, ni autorización basada en correo del cliente.

El bootstrap de `developer.gruposaysil@gmail.com` se hace una vez mediante el UUID de Auth y el runbook existente; el correo no se incorpora a una migración ni al frontend. Cada cambio administrativo se guarda en `platform_admin_audit_log`.

## Alcance inicial

- métricas agregadas de tenants, usuarios de perfil, ligas, partidos, resultados y actividad;
- catálogo de tenants y solicitudes de plan;
- edición de ofertas/precios existente y revisión manual de solicitudes;
- bitácora de intervenciones de consola.

Operaciones sobre Auth (bloqueo, eliminación, MFA), cobros reales y despliegues requieren funciones backend específicas y no se exponen desde el navegador en este alcance.
