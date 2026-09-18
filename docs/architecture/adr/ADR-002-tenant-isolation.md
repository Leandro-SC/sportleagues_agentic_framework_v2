# ADR-002 — Aislamiento multi-tenant

- Estado: Accepted

## Decisión

RLS en toda tabla tenant-owned y membresías explícitas por usuario/tenant. Ninguna autorización se basará solo en filtros del frontend.

## Requisito de prueba

Debe existir al menos un test negativo por operación sensible demostrando que un usuario del Tenant A no puede leer/escribir datos del Tenant B.
