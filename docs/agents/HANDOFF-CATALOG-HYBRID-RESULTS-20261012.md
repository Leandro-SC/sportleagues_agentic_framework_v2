# HANDOFF — Catálogo deportivo central, resultados híbridos y caché móvil (ADR-016)

- Agente: sportleagues-dev (Data, Backend, Security, Frontend, QA)
- Rama: `feat/api-football-connector` (desde `main` = `1f2b755`, que ya contiene tickets Etapa 1). **Sin merge ni despliegue a Vercel (requiere autorización).**
- Estado: PARTIAL — implementado y probado; pendientes: UAT en navegador móvil autenticado y decisión de proveedor/plan para Premium.

## Objetivo

Catálogo precargado compartido (clubes, selecciones, competiciones, países, banderas), administración en `/admin/parrilla`, resultados manuales para todos y automáticos como Premium futuro
(apagado), adaptador de proveedor desacoplado y caché móvil persistente.

## Archivos principales

- Migraciones (aplicadas a QA, 22/22): `20261017000100_sports_global_catalog.sql`, `20261018000100_catalog_seed_search_and_hybrid_results.sql` (+ `down` en `supabase/proposed/down/`).
- Semilla: `scripts/catalog/{build-catalog,load-catalog,vendor-flags}.mjs`, `supabase/seed/catalog/catalog-wikidata.json`, `apps/platform/public/flags/` (MIT).
- Adaptador/orquestación (inactivos): `supabase/functions/_shared/sports/*`, `supabase/functions/sports-sync/` (**no desplegada**), `scripts/qa/provider-probe.mjs`.
- Cliente: `lib/{offline-cache,swr,catalog-local}.ts`, `composables/{useCatalog,useSportsAdmin,usePoolPlay,useAuth}.ts`, `components/{CatalogTeamPicker,ResultsModePanel,TeamBadge}.vue`, `views/{AdminFixtureView,PoolView}.vue`.
- Pruebas: `supabase/tests/{phase-sports-catalog,phase-catalog-seed-hybrid}.sql`, `scripts/qa/e2e/{catalog-flow,catalog-concurrency}.mjs`, Vitest (ver abajo).

## Decisiones

ADR-016 (revisado): fuente Wikidata CC0; banderas MIT; **sin escudos de clubes** (licencia no verificable); automático = interruptor de plataforma `auto_results` (apagado) + plan `pro`, verificado en BD;
manual nunca se sobrescribe (conflicto registrado); `teams.country_code` admite `GB-ENG`; `teams.kind`; IndexedDB solo lectura; dependencia de desarrollo `fake-indexeddb` (pruebas de la capa IndexedDB real).
`tsconfig.app.json`: `allowImportingTsExtensions` (los módulos compartidos con Deno usan extensiones `.ts`).

## Tests ejecutados (clasificados)

- **SQL (rollback en QA):** catálogo/propagación 71/71, catálogo semilla+híbrido 63/63, y regresión íntegra con ambas migraciones: Fase 06 95/95, Fase 08 24/24, tickets 72/72, lock 51/51, privilegios 23/23, admin-participante 87/87. `down` probados.
- **E2E HTTP real contra QA (sesiones de usuario):** catálogo/híbrido **41/41**, concurrencia de importación **5/5** (6 sesiones → 1 `started`), regresión mvp-flow **32/32**, tickets-flow **24/24**.
- **Integración externa real:** `provider-probe.mjs` contra API-Football (plan Free, 4 solicitudes): búsqueda y temporada 2023 (380 partidos) OK; `ids` y temporadas actuales → `PLAN_RESTRICTED` (mapeado).
- **Unitarias (Vitest, 59 archivos / 453 tests):** adaptador y orquestación con respuestas **simuladas** (no son integración externa), caché IndexedDB real (fake-indexeddb), SWR, catálogo local, composables, vistas, semilla. `typecheck`, `build`, `verify:bundle`, `git diff --check`: OK.
- **Navegador real:** NO ejecutado (el sitio QA devuelve el desafío anti-bot de Vercel a clientes automatizados y las pantallas exigen sesión).

## Operación

- Cargar/actualizar catálogo: `node scripts/catalog/build-catalog.mjs` (red; regenera JSON) → `node scripts/catalog/load-catalog.mjs --check` → `node scripts/catalog/load-catalog.mjs` → `--verify`. Idempotente.
- Para habilitar Premium en el futuro: desplegar `sports-sync` con secretos (`API_FOOTBALL_KEY`, `API_FOOTBALL_PLAN=paid`, `SPORTS_SYNC_SECRET`, `CORS_ALLOWED_ORIGINS`), vincular partidos con `external_refs`,
  programar `sync`, y solo entonces `update platform_feature_flags set enabled=true where key='auto_results'`. Nada de esto se ha hecho.

## Riesgos / limitaciones reales

- Pertenencia de clubes a ligas (Wikidata) imperfecta fuera de Europa; sin complemento para Inglaterra/Escocia por país (P17 = Reino Unido).
- La búsqueda es local (1.433 equipos); las RPC `search_catalog_*` quedan como vía de escalado si el catálogo supera ~5.000 filas.
- Sin cooldown tras fallos del proveedor. Un partido cancelado conserva pronósticos hasta el lock natural.
- Banderas: ~1,4 MB estáticos cargados bajo demanda. El catálogo está en QA; no hay producción.

## Bloqueos

Ninguno técnico. Decisiones del propietario: autorizar merge/despliegue de esta rama; proveedor y plan de pago para Premium; UAT móvil.
