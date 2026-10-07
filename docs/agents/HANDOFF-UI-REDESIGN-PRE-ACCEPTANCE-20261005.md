# HANDOFF — Rediseño UI completo (pre-acceptance, rama `prep/ui-redesign-pre-acceptance`)

- Agente: Frontend
- Estado: PARTIAL (trabajo de preparación; sin commit, pendiente de revisión de alcance)

> **Trabajo pre-acceptance.** Fase 05/05-bis siguen sin ACCEPTED (bloqueadas por los happy paths
> HTTP contra QA, que está caído). Esto **no es inicio de Fase 06**: lo relacionado con partidos es
> preparación técnica de la capa de presentación, con datos de ejemplo detrás de un flag.

## Objetivo

Replicar las 8 pantallas de `docs/design/reference/sportleagues-ui-reference.png` (portada, Inicio,
Partidos, detalle de liga, ficha de equipo, Ligas, Unirme a una liga y Perfil) sin romper las fases
01–05 y sin presentar datos ficticios como reales.

## Archivos modificados

Vistas
- `apps/platform/src/views/HomeView.vue`: la portada se mantiene; iconos deportivos reales; la parte autenticada delega en `HomeDashboard`.
- `apps/platform/src/views/MatchesView.vue` (nueva, `/partidos`): Hoy/Mañana/Esta semana + filtro de deporte.
- `apps/platform/src/views/LeaguesView.vue` (nueva, `/ligas`): hub crear/unirse, características y "Mis ligas" reales.
- `apps/platform/src/views/JoinLeagueView.vue` (nueva, `/ligas/unirme`): búsqueda por código o nombre; los códigos válidos van a `/j/:code`.
- `apps/platform/src/views/LeagueView.vue` (nueva, `/ligas/:leagueId`): Resumen/Equipos/Partidos/Tabla.
- `apps/platform/src/views/TeamView.vue` (nueva, `/equipos/:teamId`): resumen, Partidos/Plantilla/Estadísticas y Seguir equipo.
- `apps/platform/src/views/ProfileView.vue`: rediseño con estadísticas, pestañas y Ajustes (admin y cerrar sesión).
- `apps/platform/src/views/PoolView.vue`: `ScreenHeader` con volver a Ligas; pestaña Ligas activa.

Componentes nuevos (`apps/platform/src/components/`)
- `HomeDashboard`, `ScreenHeader`, `SearchField`, `SegmentedTabs`, `SectionHeader`, `PreviewBadge`.
- `ScoreboardCard`, `UpcomingMatchCard`, `TeamMatchRow`, `LiveMatchCarousel`, `MatchStatusPill`, `StandingsTable`.
- `TeamCrest`, `CompetitionEmblem`, `CountryFlag`, `SportIcon`.
- `QuickActionTile`, `FollowedTeamCard`, `CommunityLeagueRow`, `ActivityRow`, `NotificationsButton`, `ShareMenuButton`.

Componentes modificados o eliminados
- `AppShell.vue`: la variante `app` usa `ScreenHeader` propio en cada pantalla; se eliminan FAB y `TopBar`.
- `BottomNav.vue`: cuatro rutas habilitadas con `aria-current`.
- `PrimaryButton.vue`: texto oscuro sobre el verde, por contraste.
- `JoinCodeSheet.vue` (eliminado): sustituido por "Unirme a una liga".

Lógica y datos
- `lib/preview-mode.ts`: flag `VITE_PREVIEW_DATA`; por defecto solo en desarrollo.
- `lib/sports-catalog.ts`: tipos con columnas de Fase 03 y funciones puras (ventanas de fecha, etiquetas, tabla, búsqueda, racha).
- `lib/sports-preview.ts`: dataset de ejemplo relativo a `now`.
- `lib/color-contrast.ts`, `lib/share.ts`.
- `composables/useSportsCatalog.ts`: única puerta al catálogo; Fase 06 cambiará aquí la fuente.
- `composables/useMyPools.ts`: datos reales vía `participants` + `pools` bajo RLS.
- `composables/useFollowedTeams.ts` (preferencia local), `composables/useRouteTab.ts` (`?tab=`).
- `router.ts` y `lib/navigation-guards.ts`: rutas nuevas con carga diferida, que requieren sesión y perfil.
- `env.d.ts`, `.env.example` y `apps/platform/.env.example`: `VITE_PREVIEW_DATA`.

Tests nuevos o ampliados
- `sports-catalog`, `sports-preview`, `preview-mode`, `color-contrast`, `share`.
- `useMyPools`, `useFollowedTeams`.
- `navigation-guards`, `BottomNav`, `SegmentedTabs`, `JoinLeagueView`.

Documentación
- `docs/design/DESIGN-SYSTEM.md`: principio de datos, componentes, vista previa y diferencias con la referencia.
- `reports/auth/phase-04-e2e-manual-checklist.md`: E2E-12, porque Cerrar sesión ahora está en Perfil → Ajustes.
- `PROJECT_STATE.md`.

## Contratos/API afectados

Ninguno de backend. No se tocaron migraciones, RLS, RPC, Edge Functions, Auth ni `supabase/**`.
Única lectura nueva: `participants (pool_id, approval_status)` filtrada por el `profile_id` de la
sesión, más `pools (id, name, status)`, ambas bajo las políticas `*_select_member` de Fase 03. La
autorización la decide la base de datos; el filtro solo acota el resultado.

Rutas nuevas, todas protegidas por sesión y perfil: `/partidos`, `/ligas`, `/ligas/unirme`,
`/ligas/:leagueId` y `/equipos/:teamId`.

## Decisiones

- **Datos de ejemplo solo detrás de flag** y siempre con `PreviewBadge`. En builds de QA o producción
  (`npm run build`) quedan desactivados y las pantallas muestran estados vacíos (verificado con
  `VITE_PREVIEW_DATA=false`).
- **Nunca se une a una liga de ejemplo.** Pulsar "Unirse" en una recomendada explica cómo usar un
  código real. Un código escrito, aunque coincida con un ejemplo, siempre usa el flujo real
  `join_pool`.
- **Crear liga:** para owner/admin lleva a `/admin`; para el resto muestra una hoja explicativa. No
  existe RPC de alta de tenant y no se inventó.
- **Sin escudos ni marcas oficiales:** escudos SVG genéricos con contraste calculado.
- **Sin dependencias nuevas.** Los iconos de fútbol, básquet y tenis se dibujan en SVG porque Lucide
  no los trae.

## Tests ejecutados

- `npm run typecheck`: PASS (exit 0).
- `npm test`: PASS, 20 archivos / 98 tests (antes 10 / 49).
- `npm run build`: PASS. Las vistas nuevas se generan como chunks diferidos; el chunk compartido
  `EmptyState-*.js` (312 kB, 92 kB gzip) es `@supabase/supabase-js`, que antes iba en el bundle
  principal.
- `git diff --check`: PASS.
- Revisión visual a 390 px con Chrome headless (DevTools Protocol) y auth simulada en un servidor
  temporal fuera del repo: las 8 pantallas, estados alternativos y modo sin vista previa.
  Correcciones aplicadas tras la revisión: pestañas en una línea, nombres de equipo en dos líneas y
  la marca de vista previa fuera del título.
- **NO EJECUTADO:** pruebas contra Supabase QA (caído o sin DNS). `useMyPools` y el acceso admin
  desde Perfil y Ligas están cubiertos con clientes simulados, no contra RLS real.

## Riesgos / limitaciones

- `useMyPools` no se ha probado contra QA. Si la política de `participants` filtrara distinto de lo
  esperado, "Mis ligas" saldría vacía; no hay riesgo de fuga, porque RLS manda.
- La marca sigue mezclada: la portada usa el logo Tablo y la referencia y el formulario de acceso
  dicen "SportLeagues". Es una decisión de producto pendiente.
- "Seguir equipo" es local al dispositivo hasta que exista un modelo en la base.
- Un despliegue con `VITE_PREVIEW_DATA=true` mostraría datos de ejemplo, marcados como tal. No
  activarlo en producción.

## Bloqueos

Los cierres de Fase 05/05-bis siguen bloqueados por los happy paths HTTP (`scripts/qa/*`) y la
validación manual en navegador, ambos pendientes de que QA vuelva a estar disponible.

## Próximo paso permitido

1. Revisión del alcance por el usuario y, si se aprueba, commit en esta rama. No fusionar a `main`
   antes de que Fase 05/05-bis estén ACCEPTED, salvo decisión explícita.
2. Cuando QA vuelva: ejecutar los happy paths y repetir E2E-12 y la navegación por las rutas nuevas
   con un usuario real.
3. Fase 06 (cuando se autorice): implementar la fuente real de `useSportsCatalog()` con
   `tournaments`, `teams`, `rounds`, `matches` y `official_results`, sin cambiar las vistas.
