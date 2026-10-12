# ADR-016 — Catálogo deportivo central, resultados híbridos y conector de proveedor

- Estado: Accepted (2026-10-12, por decisión de producto del propietario). **No se despliega a Vercel ni se activa ningún proveedor sin autorización aparte.**
- Complementa: ADR-009 (catálogo y escudos), ADR-010, ADR-011 (lock/calendario), ADR-012 (resultados revisables), ADR-015.
- Impacto AGENTS.md §12: esquema central (datos globales fuera de tenants), proveedor externo (preparado, inactivo), lectura móvil.

## Decisión de producto (vigente)

SportLeagues usa un **catálogo deportivo central precargado** y **resultados híbridos**. La actualización automática por API deportiva es una **función Premium futura**.
Esta decisión sustituye el enfoque inicial «importación bajo demanda desde API-Football para todos los organizadores».

## Decisión técnica

1. **Catálogo global de solo lectura para clientes** (`catalog_competitions`, `catalog_seasons`, `catalog_teams`, `catalog_competition_teams`, `catalog_countries`,
   `catalog_sources`, `catalog_fixtures`): sin `tenant_id` (datos deportivos públicos). RLS: `SELECT` a `authenticated`; ninguna escritura de clientes. Identidad
   única `(provider, external_id)`; la semilla usa `provider='wikidata'` (Q-id estable; selecciones `NT:Q…`).
2. **Fuente y licencia.** Semilla construida con `scripts/catalog/build-catalog.mjs` desde **Wikidata (CC0)**; se carga con `scripts/catalog/load-catalog.mjs`
   (`catalog_seed_load`, idempotente, solo postgres/service_role). Procedencia y licencia quedan en `catalog_sources`. Las pertenencias a ligas son «clubes registrados en la liga
   según Wikidata en la fecha de carga» (puede incluir/omitir clubes de la temporada vigente): el organizador siempre puede añadir equipos manualmente. Sin datos ficticios.
3. **Recursos visuales.** Banderas: paquete MIT `flag-icons` vendorizado en `public/flags` (con licencia). **Escudos de clubes: no se almacenan ni se enlazan** (no existe una fuente libre y
   autorizada; ni API-Sports ni Wikimedia ofrecen licencia verificada para logos de clubes). Se mantiene el escudo generado (ADR-009). Reabrir solo con licencia documentada.
4. **Los datos de los tenants siguen aislados.** Importar equipos (`import_catalog_teams`, máx. 60) o una jornada (`import_catalog_round`) **copia** a entidades tenant-owned
   y vincula con `external_refs` (Fase 06). Autoriza `is_tenant_admin` del torneo; el tenant sale de la entidad, nunca del cliente. Un equipo manual homónimo se reutiliza.
   Quinielas, tickets, pronósticos, ingresos y permisos no se comparten. `teams.kind` (club|national) y `country_code` (ISO-3166-1 o subdivisión `GB-ENG`) permiten bandera.
5. **Resultados híbridos.** `tournaments.results_mode`: `manual` (todos; por defecto) | `automatic`.
   - **Manual:** `publish_official_result` (revisión esperada, idempotente, auditado, recalcula scoring). Un resultado publicado/confirmado por un administrador es `source='manual'`.
   - **Automático (Premium futuro):** `set_tournament_results_mode('automatic')` exige, **en la base de datos**, `platform_feature_flags.auto_results = true` (APAGADO) **y** plan `pro` del tenant.
     La propagación (`catalog_propagate_fixtures`, solo service_role) vuelve a comprobarlo por partido y solo actúa sobre partidos vinculados por `external_refs` en torneos automáticos.
     Sin cobertura/vínculo → administración manual.
   - **Conflictos:** el proveedor nunca sobrescribe un resultado manual: se registra `conflict_manual_result` en `fixture_sync_log` (visible a administradores). Una corrección del
     proveedor sobre un resultado de proveedor sube la revisión y recalcula idempotentemente (ADR-012). Reprogramaciones respetan ADR-011 (adelantar bloquea ya; un lock alcanzado nunca se reabre).
     Aplazados/cancelados/abandonados se reflejan en `matches.provider_state` sin ampliar `match_status`. El marcador es a 90 minutos (`score.fulltime`).
6. **Adaptador desacoplado** (`supabase/functions/_shared/sports`): interfaz `SportsProvider` + implementación API-Football (plan-aware); el proveedor se elige por configuración de backend
   (`provider`, `API_FOOTBALL_PLAN`); football-data.org u otro = nueva implementación, sin cambios en pronósticos, tickets, rankings ni frontend. La Edge Function `sports-sync` **no está desplegada**
   ni programada; control de cuota diario atómico (`provider_consume`), deduplicación de importaciones concurrentes (`catalog_begin_import`), 429 con reintentos acotados y degradación controlada.
   Hallazgo verificado del plan Free de API-Football: solo temporadas 2022–2024, sin parámetro `ids`, `date` limitado a ±1 día, `live=all` disponible → la sincronización de temporadas en curso
   requiere plan de pago (coste fuera de alcance).
7. **Caché móvil** (`lib/offline-cache`, `lib/swr`, `lib/catalog-local`): IndexedDB (justificada: antes solo `localStorage` para banderas), espacios `public` y `u:<usuario>`, versión de esquema, TTL con ventana
   «obsoleto» de 7 días, límites de bytes/entradas con desalojo LRU, borrado de datos privados al cerrar sesión/cambiar de usuario, deduplicación de solicitudes en vuelo, revalidación en segundo plano,
   catálogo local-first con sincronización incremental por `updated_at` y estado «sin conexión / actualizado». Frecuencias: catálogo 24 h; quiniela 1 min (partidos activos) o 10 min.
   **Solo lectura:** pronósticos, tickets y resultados se confirman siempre en servidor; tras guardar se fuerza lectura del servidor; la hora del dispositivo nunca decide un lock.

## Alternativas descartadas

- Importación a demanda por organizador desde un proveedor: multiplica cuota/coste y no es necesario para el modo manual.
- Ampliar `match_status`: cambia la máquina de estados protegida por H1–H6.
- Descargar o enlazar escudos de terceros: sin licencia verificada.
- Catálogo por tenant: duplica y rompe la deduplicación.

## Consecuencias / riesgos

- Calidad de Wikidata: pertenencia a ligas imperfecta fuera de Europa (documentada y mitigada con alta manual). Catálogo sin deportes distintos del fútbol por ahora.
- Un partido cancelado conserva pronósticos hasta el lock natural (sin puntos); el organizador puede retirarlo si no tiene pronósticos.
- Sin cooldown tras fallos del proveedor (cada intento está acotado por la cuota diaria): mejora futura si se activa Premium.

## Rollback

Migraciones forward-only con `down` en `supabase/proposed/down/` (probados dentro de una transacción). Datos copiados a tenants permanecen válidos.
