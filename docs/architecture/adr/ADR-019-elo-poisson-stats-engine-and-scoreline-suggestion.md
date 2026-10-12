# ADR-019 — Motor estadístico Elo + Poisson y sugerencia de marcador

- Estado: **Proposed** (2026-10-12). Propuesta en `supabase/proposed/20261021000100_stats_elo_poisson.sql`; **no se aplica a QA ni a producción sin autorización expresa**.
- Contrato detallado: `docs/architecture/STATS-ENGINE-CONTRACT.md` (fórmulas, parámetros, errores).
- Relacionados: ADR-003/005 (scoring en servidor), ADR-011 (lock), ADR-012 (resultados revisables), ADR-015 (administrar o competir), AGENTS.md §4 y §7, `docs/requirements/04-stats-engine.md`.
- Impacto AGENTS.md §12: esquema (columnas en `team_ratings`, dos tablas nuevas) y función de lectura nueva para el participante.

## Decisión

1. **Autoridad en SQL** (AGENTS §4): funciones puras `IMMUTABLE` para Elo, Poisson, matriz de marcadores, 1X2 y elección determinista del marcador; versión de modelo `elo-poisson-v1` con parámetros **inmutables** en `stats_model_params` (cambiar = publicar otra versión).
2. **Ratings por tenant** (los equipos son del tenant; compartirlos entre tenants filtraría datos). Solo `football`; Poisson de goles no aplica a otros deportes.
3. **Reconstrucción determinista** `rebuild_team_ratings` (solo `service_role`): repite todos los resultados oficiales vigentes en orden `(starts_at, id)` y reemplaza atómicamente el alcance; idempotente, sin doble conteo tras una corrección (ADR-012). Se dispara bajo demanda, **no** desde `publish_official_result`, para no tocar la transacción crítica. Cada corrida queda en `stats_rating_runs` y en `audit_log`.
4. **`suggest_scoreline(p_pool_match_id)`**: solo `authenticated`, solo lectura, solo participante elegible (administradores y excluidos ADR-015 denegados), solo antes del lock del servidor. No escribe pronósticos, ratings ni `model_predictions` (esa tabla es legible por el tenant y escribirla filtraría quién consultó qué).
5. **Presentación (AGENTS §7):** siempre como *sugerencia estadística*, nunca certeza ni recomendación de apuesta; la respuesta incluye `model_version`, `computed_at`, `rated` y un `disclaimer`. El cliente solo rellena el formulario: guardar sigue pasando por `save_prediction`/`save_ticket_prediction` con su lock.

## Consecuencias

- Sin ejecutar `rebuild_team_ratings`, toda sugerencia sale con `rated=false` (ratings por defecto 1500); la UI debe decirlo.
- Pendiente de autorización: aplicar a QA, primera reconstrucción por entorno, y el job de servidor que la repita tras resultados o correcciones.
- Limitaciones declaradas: sin sede neutral, forma ni lesiones; el marcador más probable puede no coincidir con el 1X2 más probable.
- Antes de promocionar otra `model_version`, reconstruir sus ratings y solo entonces alternar `is_current`.
