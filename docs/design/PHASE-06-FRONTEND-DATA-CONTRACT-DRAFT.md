# Contrato de datos del frontend para Fase 06 — BORRADOR TÉCNICO

> **Estado: borrador de preparación pre-acceptance. Fase 06 NO está iniciada formalmente** y este
> documento no la inicia. Nada de lo descrito está conectado a la app ni se ha probado contra
> Supabase QA. No modifica base de datos, migraciones, RLS, RPC ni Edge Functions.
>
> Precedencia (AGENTS.md §2): este borrador queda por debajo de `AGENTS.md`, los ADR y
> `docs/architecture/phase-02-contracts.md`. Si hay conflicto, manda el contrato de arquitectura.

## Qué se preparó (solo frontend)

| Pieza | Archivo | Rol |
| --- | --- | --- |
| Modelo de presentación | `lib/sports-catalog.ts` | Tipos y funciones puras que usan las pantallas. |
| Adaptador de filas | `lib/sports-adapters.ts` | Filas de Fase 03 → modelo de presentación, con validación defensiva. |
| Costura de origen | `lib/sports-source.ts` | `SportsDataSource` + fuente Supabase (solo `SELECT`, **no conectada**). |
| Fuente de ejemplo | `lib/sports-preview.ts` | Misma interfaz; carga diferida y solo con `VITE_PREVIEW_DATA`. |
| Ayudas de pronóstico | `lib/prediction-ux.ts` | Estado/etiqueta de lock, `lock_offset` y validación del marcador. Solo UX. |

Las vistas leen únicamente `useSportsCatalog()`. Cambiar de la vista previa a datos reales es
sustituir una línea en ese composable (hay un comentario en el punto exacto).

## Mapeo de columnas (Fase 03 → presentación)

| Tabla / columna | Presentación | Notas |
| --- | --- | --- |
| `tournaments.id, name` | `Competition.id, name` | No se pide `tenant_id`. |
| `teams.id, name` | `Team.id, name` | `short_name` y `colors` se **derivan** (ver brechas). |
| `teams.crest_asset_path` | `Team.crest_path` | Hoy no se muestra: no hay bucket ni política de escudos. |
| `rounds.name` (por `round_id`) | `Match.round_name` | Si la jornada es de otro torneo se ignora y se avisa. |
| `matches.*` | `Match.*` | `status` ∈ `scheduled · live · final` (enum `match_status`). |
| `official_results` por `match_id` | `Match.home_score/away_score` | Gana la mayor `revision`; marcadores inválidos se descartan. |
| derivado de `matches` + resultados | `standings[tournament]` | Solo presentación, ver "Tabla de posiciones". |

Garantías del adaptador (cubiertas por `sports-adapters.test.ts`):

- Un partido que referencia equipos o torneos fuera del conjunto visible se **descarta** con
  advertencia `MATCH_BROKEN_REFERENCE` (defensa extra del requisito "un partido no puede unir
  equipos de otro tenant"; la barrera real es RLS + FK compuestas).
- Un estado fuera del MVP (por ejemplo `postponed`) se descarta con `MATCH_STATUS_UNSUPPORTED`;
  no se inventa una etiqueta. Cancelado/postergado sigue pendiente de contrato de producto.
- Un partido `final` sin resultado se muestra sin marcador y con `FINAL_WITHOUT_RESULT`.
- El cliente nunca usa `tenant_id` para autorizar; la fuente ni siquiera lo pide.

## Autoridad: qué NO hace el frontend

- **Lock y pronósticos:** el límite lo evalúa PostgreSQL con `now()` dentro de `save_prediction`
  (`now() < starts_at - lock_offset`). `prediction-ux.ts` solo muestra una cuenta atrás y puede estar
  desfasada por el reloj del dispositivo; el servidor siempre decide.
- **Scoring y desempate de la quiniela:** server-authoritative (ADR-003). La tabla de posiciones del
  torneo que calcula el adaptador es un resumen visual (3/1/0, diferencia de goles, goles a favor) y
  **no** es el leaderboard ni la regla de desempate de la quiniela.
- **Resultados:** el frontend solo lee `official_results`; publicar o corregir es
  `publish_official_result` (RPC planificada, owner/admin).

## Brechas: qué falta para conectar cuando QA vuelva

Ordenadas por dependencia. Las marcadas **(BD)** requieren migración o ADR y por tanto
autorización explícita según `AGENTS.md` §12; este borrador no las toca.

1. **Verificar lectura real bajo RLS** con un usuario `member`, uno `admin` y otro de otro tenant
   (las cinco tablas tienen `*_select_member` en Fase 03). Confirmar paginación: PostgREST limita a
   1000 filas por consulta; hoy no se pagina.
2. **Pool, no tenant:** Partidos debería mostrar los partidos de las ligas del usuario
   (`pool_matches`) y el `lock_offset` de cada `pool`; hoy el catálogo es por tenant. Falta decidir
   cómo agregar varias ligas y cómo presentar el lock por liga.
3. **Varios tenants:** un usuario puede ser miembro de varios; las filas llegan unidas. Falta
   desambiguar nombres repetidos mostrando el tenant.
4. **(BD) Datos que `tournaments` no tiene:** deporte, país, temporada y color. Hoy el adaptador
   asume `football`, sin país y sin temporada. El filtro por deporte de Partidos solo funcionará con
   datos reales cuando exista esa columna.
5. **(BD) Datos que `teams` no tiene:** país, colores y torneo (un equipo pertenece al tenant, no a
   una competición). Hoy se deriva el torneo del que más partidos le asigna y los colores salen de
   un hash del id. Un equipo en dos torneos se muestra solo en uno.
6. **(BD) Escudos:** `crest_asset_path` existe, pero no hay bucket, política ni ciclo de vida de
   subida para escudos (ADR-006/007 cubren solo branding). Sin eso se usa el escudo genérico.
7. **(BD) RPC de escritura:** `manage_schedule` y `publish_official_result` figuran en
   `phase-02-contracts.md` pero no existen en las migraciones. La UI de administración de
   Fase 06 depende de ellas y de su recálculo idempotente.
8. **Minuto en vivo:** no hay proveedor de datos en vivo en el MVP; `minute` siempre es `null`. La
   etiqueta "En vivo" sale solo del estado del partido.
9. **Tabla de posiciones:** se calcula en el cliente a partir de partidos y resultados. Revisar si
   Fase 08 la sirve desde SQL (view/función) para evitar descargar todos los partidos.
10. **Solo vista previa, sin modelo (fuera del MVP o sin fuente):** ligas recomendadas, actividad,
    nivel y puntos del perfil, "equipos seguidos" (hoy local al dispositivo). Con datos reales quedan
    vacíos; no deben conectarse sin un contrato.

## Lista de comprobación cuando QA vuelva (y Fase 06 se autorice)

- [ ] Fase 05/05-bis ACCEPTED (happy paths HTTP y revisión manual de `/admin` y `/superadmin`).
- [ ] Fase 06 autorizada formalmente y registrada en `PROJECT_STATE.md`.
- [ ] Decidir y resolver las brechas **(BD)** con ADR/migraciones por el agente Data/RLS.
- [ ] Sustituir la fuente en `useSportsCatalog()` por `createSupabaseSportsSource(getSupabaseClient())`.
- [ ] Probar con usuarios real de cada rol y confirmar que un usuario de otro tenant recibe cero filas.
- [ ] Revisar las advertencias del adaptador contra datos reales y decidir qué se muestra al usuario.
- [ ] Mantener `npm run verify:bundle`: el dataset de ejemplo no debe viajar en builds de QA/producción.
