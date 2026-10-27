# ADR-030 — Alcance seguro del Control Plane de Superadministración

- Estado: Accepted
- Fecha: 2026-10-26
- Decisor: Propietario del producto

## Contexto

El propietario solicita un dashboard premium que centralice el control de las aplicaciones, métricas y estadísticas de plataforma. La consola es cross-tenant y no puede convertirse en un navegador de tablas ni conceder permisos globales al cliente.

## Decisión

1. El Control Plane concentra solo capacidades globales expuestas explícitamente por funciones PostgreSQL protegidas: agregados operativos, directorio de organizaciones, solicitudes de plan y catálogo de ofertas.
2. Los indicadores muestran únicamente datos retornados por RPCs. Las series históricas requieren fuente agregada, retención y pruebas propias antes de añadirse.
3. Cada control nuevo será una operación de servidor mínima, autorizada por `platform_console_guard()`, auditada en `platform_admin_audit_log` y cubierta por pruebas negativas. No habrá acceso directo global a tablas desde el navegador.
4. Suspender/eliminar tenants, gestionar usuarios de Auth/MFA, cambiar membresías globales, configurar secretos o desplegar aplicaciones quedan fuera de este incremento. Cada uno requiere ADR, endpoint específico, auditoría y confirmación explícita.
5. El panel mantiene su origen Vercel aislado; no contiene `service_role` ni credenciales de infraestructura.

## Consecuencias

La consola evoluciona como centro profesional sin ampliar privilegios por conveniencia visual. Cobros, wallet, iGaming y controles directos de infraestructura siguen fuera del MVP.
