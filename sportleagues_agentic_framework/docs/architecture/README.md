# Arquitectura propuesta

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
