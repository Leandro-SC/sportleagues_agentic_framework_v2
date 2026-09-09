# PROJECT_CONFIG.md

## Identidad

- Proyecto: `SportLeagues / BetAdmin`
- Tipo: `SaaS multi-tenant de quinielas y pronósticos deportivos`
- MVP: `PWA + Android wrapper; arquitectura preparada para iOS`

## Stack aprobado de base

- Frontend: `Vue 3 + Vite`
- Lenguaje: `TypeScript` (propuesto para reducir errores entre agentes)
- Estilos: `Tailwind CSS`
- Iconos: `Lucide`
- State/query: `PENDING — elegir en ADR si hace falta dependencia adicional`
- Backend/Auth/DB: `Supabase + PostgreSQL + RLS`
- Motor: `PostgreSQL functions/stored procedures — Elo + Poisson + scoring`
- Móvil: `Capacitor`
- PWA: `Vite PWA strategy — implementación concreta pendiente`
- Flyers: `Canvas/html2canvas + QR + Web Share API`
- Hosting web: `Vercel o Netlify — decisión de release`

## Principios

- Mobile first.
- Server-authoritative para locks, permisos y scoring.
- RLS como frontera primaria de tenant isolation.
- Sin service-role key en clientes.
- Sin dinero real ni escrow en MVP.
- Sin APIs deportivas pagadas en MVP salvo ADR posterior.

## Entornos

- local
- preview/staging
- production

Cada entorno debe usar proyecto/configuración Supabase separada cuando sea viable.

## Restricciones de hardware/desarrollo

El proyecto busca ser utilizable en equipos de desarrollo modestos; evitar toolchains innecesariamente pesados. Android/iOS requieren toolchain nativo únicamente al producir/verificar builds nativos.
