# Arquitectura propuesta

El contrato implementable de Fase 02 esta en
[`phase-02-contracts.md`](phase-02-contracts.md). Los ADRs aceptados de esta fase
son ADR-004, ADR-005 y ADR-006.

## Diagrama lógico

```text
[Vue 3 PWA / Capacitor]
        |
        | Supabase client (user token)
        v
[Auth] [PostgREST/RPC] [Storage]
        |       |
        |       v
        |   [PostgreSQL]
        |     - tenants/memberships
        |     - pools/tournaments/matches
        |     - predictions/results
        |     - scoring/leaderboards
        |     - entitlements/audit
        |     - Elo/Poisson functions
        |
        +--> RLS en todas las superficies tenant-owned
```

## Separación de capas

- UI: componentes y páginas; nunca decide autorización final.
- Application services: llamadas tipadas a Supabase/RPC.
- Domain: reglas puras y tipos compartidos.
- Database: integridad, RLS, locks temporales, scoring y cálculos críticos.
- Mobile shell: permisos nativos, deep links, notificaciones y packaging.

## Regla de autoridad

Los siguientes controles deben ser server-authoritative: tenant access, lock de pronósticos, scoring, recálculo, entitlements PRO y resultados oficiales.
