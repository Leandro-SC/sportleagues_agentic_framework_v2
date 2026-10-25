# Contrato del motor estadístico Elo + Poisson (Fase 09)

- Estado: PROPUESTA, no aplicada a ningún entorno (sin Docker; validada solo en transacción con rollback sobre QA).
- Autoría: agente Domain/Scoring. Implementación: `supabase/proposed/20261021000100_stats_elo_poisson.sql` (down en `supabase/proposed/down/`).
- Suite: `supabase/tests/stats-elo-poisson.sql` (115 comprobaciones).
- Base normativa: AGENTS §6/§7, `docs/requirements/04-stats-engine.md`, `phase-02-contracts.md` (`get_stat_suggestion`), ADR-003, ADR-005, ADR-011, ADR-012, ADR-015.

> AGENTS §12 exige ADR cuando se cambia el esquema central. Esta propuesta solo añade dos tablas, parámetros y columnas a `team_ratings`
> (tabla sin escritores ni filas). Se recomienda que Architect la formalice (p. ej. ADR-019) al aceptar la migración.

## 1. Principios

1. El auto-fill es una **estimación estadística**: no es certeza ni recomendación de apuesta. La respuesta incluye `disclaimer`, `model_version` y `computed_at`.
2. Determinismo: sin aleatoriedad ni reloj en el cálculo; la misma entrada produce la misma salida. El único dato variable de la respuesta es `computed_at`.
3. Solo lectura para el participante: `suggest_scoreline` no escribe pronósticos, ratings ni `model_predictions`.
4. La autoridad (elegibilidad, lock, tenant) está en la base; el cliente no envía `tenant_id` ni hora.

## 2. Modelo (`model_version = 'elo-poisson-v1'`, deporte `football`)

Parámetros en `public.stats_model_params` (versionados e **inmutables**: un trigger rechaza UPDATE de parámetros y DELETE; para cambiar se publica otra versión).

| Parámetro | Valor v1 | Significado |
| --- | --- | --- |
| `elo_initial` | 1500 | Rating de un equipo sin historial |
| `elo_scale` | 400 | Escala logística Elo |
| `elo_k` | 20 | Factor K |
| `elo_home_adv` | 65 | Ventaja local en puntos Elo (no hay indicador de sede neutral en el modelo de datos) |
| `elo_goal_margin` | true | Multiplicador por diferencia de goles |
| `base_goals` | 1.35 | Goles esperados por equipo con ratings iguales y sin ventaja |
| `goal_slope` | 0.5 | Sensibilidad del λ al diferencial Elo |
| `goal_dr_clamp` | 2 | Tope de \|diferencial\|/escala (800 puntos) antes de calcular λ |
| `max_goals` | 6 | Matriz 0..6 por equipo |

### Fórmulas

- Elo esperado: `E = 1 / (1 + 10^(-(Rh + ventaja - Ra)/escala))`. Exponente acotado a ±50.
- Actualización: `S = 1 | 0.5 | 0`; `delta = K · G · (S − E)`; local `+delta`, visitante `−delta` (suma cero). Ambos se calculan con los ratings previos.
  `G` = 1 si \|dif\| ≤ 1; 1.5 si 2; `(11 + \|dif\|)/8` si ≥ 3.
- λ de goles: `dr = clamp((Rh + ventaja − Ra)/escala, ±tope)`; `λ_local = base·exp(+pendiente·dr)`, `λ_visitante = base·exp(−pendiente·dr)`.
  La ventaja local solo entra por el diferencial (no hay doble conteo). La media geométrica de ambos λ es siempre `base`.
- Poisson: `pmf(k, λ) = e^-λ · λ^k / k!` por recurrencia. Rango válido λ ∈ [0, 100], k ∈ [0, 200].
- Matriz: celdas `(h, a)` con `h, a ∈ 0..max_goals`, `prob = pmf(h,λh)·pmf(a,λa) / (Σpmf(·,λh) · Σpmf(·,λa))`. **Renormalización documentada**: la masa fuera del rango se reparte
  proporcionalmente, de modo que las `(max_goals+1)²` celdas suman 1.
- 1X2: `P(local) = Σ(h>a)`, `P(empate) = Σ(h=a)`, `P(visitante) = Σ(h<a)` sobre la matriz renormalizada.
- Marcador más probable con desempate determinista (probabilidades comparadas redondeadas a 12 decimales): 1.º mayor probabilidad; 2.º menos goles totales; 3.º más goles locales; 4.º menos goles visitantes.
  Con λ=(1,1) hay cuatro celdas empatadas y se elige 0-0; con λ=(2,2) se elige 1-1.

Limitaciones honestas: el marcador más probable de una matriz Poisson suele ser 1-0/1-1 y **no tiene por qué coincidir con el resultado 1X2 más probable**; por eso la respuesta incluye `p_scoreline` y las tres probabilidades 1X2. Sin sede neutral, sin lesiones/forma, sin ajuste por competición. Rangos de ratings reales de equipos con pocos partidos son poco fiables (`rated=false` cuando falta historial).

## 3. Estado: `team_ratings` y reconstrucción

- `team_ratings` (existente) se **extiende sin romper**: `sport_code`, `matches_played`, `last_match_at`, `run_id`; único `(tenant_id, team_id, sport_code, model_version)`. Escritura solo por el motor; los clientes conservan únicamente SELECT (RLS por membresía).
- `stats_rating_runs`: una fila por tenant y reconstrucción con copia de parámetros, partidos/equipos procesados y dos huellas md5 (entrada ordenada y ratings resultantes). Lectura solo owner/admin del tenant. Cada corrida se audita (`stats.ratings_rebuilt`).
- Los ratings son **por tenant** (los equipos son del tenant): ningún resultado de un tenant influye en otro (aislamiento ADR-002).

### `rebuild_team_ratings(p_sport_code text default 'football', p_tenant_id uuid default null, p_model_version text default null) returns jsonb`

- EXECUTE solo `service_role` (más guarda interna `auth.role() = 'service_role'`). No se concede a `authenticated`/`anon`.
- Repite **todos** los resultados oficiales vigentes (una fila por partido, revisión actual; ADR-012 no conserva historial de marcadores en `official_results`) en orden `(matches.starts_at, matches.id)`, desde `elo_initial`. Excluye partidos con `provider_state` (aplazados/cancelados).
- Reemplaza en una transacción las filas del alcance (tenant o todos); un candado asesor por deporte serializa las reconstrucciones. Corregir un resultado y reconstruir produce el mismo estado que si el marcador corregido hubiera sido el original: sin doble conteo (probado, incluido el retorno exacto al estado inicial).
- Devuelve `{model_version, sport_code, tenants, matches_processed, teams_rated}`. Los ratings reflejan los resultados existentes al leer; un resultado publicado durante la corrida entra en la siguiente.
- **No se modifica `publish_official_result`.** Decisión: la reconstrucción es **bajo demanda** (más simple, aislada y reversible; evita añadir trabajo a la transacción crítica de publicación y mantiene intacto el scoring). Disparo propuesto (requiere autorización humana): job programado de servidor (Edge Function/cron con service_role) tras ventanas de resultados, y manualmente tras correcciones relevantes. Una versión incremental dentro de `publish_official_result` queda como evolución posible con ADR.

## 4. Contrato de `suggest_scoreline(p_pool_match_id uuid) returns jsonb`

Parámetro: id de `pool_matches` (el mismo que usa el cliente para el partido en la quiniela). EXECUTE: `authenticated` únicamente (no `anon`/PUBLIC). `SECURITY DEFINER`, `search_path` vacío.

### Éxito

```json
{
  "home_goals": 1, "away_goals": 1,
  "p_scoreline": 0.119139,
  "p_home": 0.464581, "p_draw": 0.251133, "p_away": 0.284286,
  "lambda_home": 1.563116, "lambda_away": 1.165940,
  "model_version": "elo-poisson-v1",
  "computed_at": "2026-10-21T12:00:00.123456+00:00",
  "ratings_as_of": "2026-10-21T11:00:00+00:00",
  "rated": true,
  "disclaimer": "Estimación estadística (Elo + Poisson) basada en resultados anteriores. No es una certeza ni una recomendación de apuesta: puedes ignorarla o cambiarla."
}
```

- `p_home + p_draw + p_away = 1` exactamente con 6 decimales (`p_away` se calcula por resta).
- `rated = false` si falta el rating de cualquiera de los dos equipos (se usa `elo_initial` = 1500 para el faltante; `ratings_as_of = null`). Se debe mostrar como "estimación con poca información".
- `ratings_as_of` = momento de la reconstrucción de los ratings usados (el más antiguo de los dos); `computed_at` = reloj de la base al calcular.
- Los campos extra `p_scoreline` y `ratings_as_of` amplían el contrato original; el resto coincide.

### Errores (SQLSTATE / `hint`; el cliente debe discriminar por `hint`)

| Caso | SQLSTATE | hint |
| --- | --- | --- |
| Sin sesión | `28000` | — |
| `pool_match` inexistente **o** de un tenant del que el llamante no es miembro activo (indistinguibles, sin sondeo) | `22023` | `STATS_NOT_FOUND` |
| Administrador de la quiniela (owner/admin del tenant, staff, exclusión persistida; ADR-015) | `42501` | `ADMIN_PARTICIPANT_INCOMPATIBLE` |
| Miembro sin participación aprobada y activa (no inscrito, pendiente, retirado) | `42501` | `STATS_NOT_ELIGIBLE` |
| Partido bloqueado (`clock_timestamp() >= lock_at`, lock persistido ADR-011), partido no `scheduled` o quiniela no `open` | `42501` | `STATS_LOCKED` |
| Deporte del torneo sin modelo (solo `football` en v1) | `22023` | `STATS_UNSUPPORTED_SPORT` |

Orden de evaluación: sesión → existencia/tenant → administrador → participante → lock → deporte. La elegibilidad usa la misma primitiva que ADR-015 (`is_pool_excluded`), sin tomar los candados de escritura de `assert_pool_participation_allowed`.

### Qué NO hace y por qué

- **No registra en `model_predictions`.** Esa tabla es legible por todo el tenant: aunque la fila fuera por partido y no por jugador, escribir desde un RPC de lectura abre contención y crecimiento por llamada, y permitiría inferir quién consultó qué y cuándo. La trazabilidad (versión y timestamp) viaja en la respuesta; una instantánea por partido queda para un job de servidor si se necesita.
- No escribe el pronóstico: el participante decide y guarda con `save_prediction`/`save_ticket_prediction`.
- No deriva ni revela pronósticos ajenos (la entrada son solo ratings del tenant).

## 5. Seguridad y privilegios

- Funciones puras (`stats_elo_expected`, `stats_elo_update`, `stats_poisson_pmf`, `stats_goal_expectations`, `stats_scoreline_matrix`, `stats_outcome_probs`, `stats_pick_scoreline`): `IMMUTABLE`, `STRICT`, `search_path` vacío, validan rangos (22023), EXECUTE solo `service_role` (las invocan las funciones del motor como definer).
- `stats_model_params`: RLS, SELECT para `authenticated`; sin escrituras de cliente; versiones inmutables.
- `stats_rating_runs`: RLS, SELECT solo owner/admin del propio tenant; sin escrituras de cliente.
- `team_ratings`: SELECT por membresía (existente); INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER revocados.
- Sin `tenant_id` del cliente en ninguna función de lectura; sin PII en corridas ni auditoría.
- Riesgo residual: `suggest_scoreline` es barata y determinista pero sin límite de tasa propio (el rate limiting es de la capa API); la matriz está acotada a 13×13.

## 6. Pruebas (resumen)

Vectores calculados con un script JS independiente (Elo, pmf, λ, 1X2, moda, ratings tras la secuencia de 4 partidos y tras la corrección), monotonicidad, determinismo, IMMUTABLE/search_path,
reconstrucción idempotente y tras corrección/reversión, aislamiento entre tenants, RLS/ACL, y negativos de `suggest_scoreline` (otro tenant, sin membresía, id inexistente/nulo, administrador, exclusión,
no inscrito, pendiente, retirado, anon, sin sesión, lock por offset, partido en vivo, partido adelantado por el sincronizador, quiniela pausada, deporte sin modelo) más controles positivos.

## 7. Aplicación (requiere autorización humana)

1. Revisión de Architect (ADR) y Security de esta propuesta.
2. Aplicar a QA/staging solo con autorización explícita; mover a `supabase/migrations/` tras aprobación.
3. Primera ejecución de `rebuild_team_ratings` en cada entorno tras aplicar; después programada o tras correcciones. Antes de promocionar una nueva `model_version`, reconstruir sus ratings (`p_model_version`) y solo entonces alternar `is_current`.
4. Rollback: `supabase/proposed/down/20261021000100_stats_elo_poisson.down.sql` elimina el motor y los datos derivados (reconstruibles); no toca resultados, pronósticos ni scoring.
