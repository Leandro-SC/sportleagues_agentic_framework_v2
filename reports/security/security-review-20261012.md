# Revisión de seguridad — rama `feat/api-football-connector` (2026-10-12)

Agente: Security. Alcance: Encargo Maestro §5 y §7, AGENTS §5/§6/§12, ADR-002/008/011/012/015/016. **Nada se aplicó a QA**; las suites corrieron en transacción con rollback
(`scripts/qa/run-sql-suite.mjs`). Este informe **no afirma «cero vulnerabilidades»**: lista lo encontrado y lo no verificado (sección 5).

## 1. Resumen

- **Críticos: 0. Altos: 0** conocidos. (Se descartó el alto de `npm audit`: ver F-09, corregido en el lockfile.)
- **Medios: 3** — F-04 (finanzas legibles por todo miembro del tenant; corrección propuesta lista y probada), F-05 (cuota del proveedor agotable por cualquier administrador de tenant; latente, función no desplegada), F-06 (sin cabeceras de seguridad HTTP/CSP en el despliegue).
- **Bajos: 6** — F-01, F-02, F-03 (los tres hallazgos bajos del conector, corregidos en la migración propuesta), F-07, F-08, F-10.
- Para recomendar lanzamiento (Encargo §7): F-04, F-05 y F-06 requieren corrección o aceptación formal documentada.

## 2. Tabla de hallazgos

| Id | Sev. | Hallazgo | Evidencia (archivo:línea) | Estado | Responsable |
| --- | --- | --- | --- | --- | --- |
| F-04 | **Media** | Cualquier miembro de un tenant lee `participants` completa, incluido `payment_status` de todos los participantes de **todas** las quinielas del tenant (política `participants_select_member = is_tenant_member`; sin restricción por columna). Incumple Encargo §5 («user no lee pagos ajenos») y ADR-014 D8. Cross-tenant NO afectado. Reproducido en QA (línea base, rollback): un participante ve 3 filas en lugar de 1; un miembro sin participación ve 3; personal `pool_finance` ve pagos de otra quiniela. | `supabase/migrations/20260908000100_phase_03_tenant_foundation.sql:112` (política generada por el bucle), `:135` (solo se revocó I/U/D); catálogo QA: `participants_select_member [SELECT] is_tenant_member(tenant_id)`; frontend solo lee la propia fila (`useMyPools.ts:41`, `usePoolPlay.ts:69`) o lista como admin (`useAdmin.ts:132`) | **Propuesto** (migración, probado; no aplicado). Política `participants_select_scoped`: propia fila, admin del tenant o capacidad `finance` de esa quiniela. Requiere aprobación (AGENTS §12, reduce autorización) + nota en ADR-014/015 | Data/RLS (aplicar) · Architect (nota ADR) |
| F-05 | **Media** (latente) | `sports-sync` acepta `search` e `import_season` de **cualquier** propietario/admin de **cualquier** tenant; cada clave distinta (`search:<q>`, `season:<id>:<año>`) cuesta solicitudes al proveedor sin tope por usuario. Un administrador malicioso puede agotar la cuota diaria compartida (queda solo la reserva de 10 para `sync`) y degradar el proveedor para todos. Hoy la función **no está desplegada** y `auto_results` está apagado, por eso no es alto. | `supabase/functions/sports-sync/index.ts:110-120` (autorización = membresía admin en algún tenant), `:155-156`; `supabase/functions/_shared/sports/sync.ts:81,92` (límite global `dailyLimit - syncReserve`, sin límite por usuario) | **Propuesto / requiere decisión** (no implementado: cambia quién puede llamar → ADR-016 §). Opciones: restringir `search`/`import_season` a `platform_admin` (ADR-008) o tope diario por `requested_by` en `catalog_import_jobs`. **Bloquea el despliegue de `sports-sync`** | Backend/Architect · decisión del propietario |
| F-06 | **Media** | `vercel.json` solo define rewrites: sin CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS. El token de sesión puede vivir en `localStorage` («Recordar mi cuenta»), por lo que la ausencia de CSP aumenta el impacto de un eventual XSS; clickjacking posible. Mitigante verificado: no hay `v-html`/`innerHTML`/`eval` en `apps/platform/src` (ver §4). | `vercel.json:1-8`; `apps/platform/index.html` (sin meta CSP); `apps/platform/src/lib/session-storage.ts:19-27` | **Propuesto** (no editado: zona Release). Añadir bloque `headers` en `vercel.json` y probar la app con CSP en modo `Report-Only` antes de imponerla (Supabase, Google OAuth, fuentes) | Release |
| F-01 | Baja | Orden de bloqueo/autorización: las RPC tomaban `FOR UPDATE` sobre la fila (torneo/partido/participante) **antes** de `is_tenant_admin`, y respondían `22023 not found` vs `42501`. Un miembro del mismo tenant que conozca el UUID puede forzar contención de bloqueo (milisegundos por llamada; las RPC son transacciones cortas) y cualquier usuario que conozca un UUID obtiene un oráculo de existencia. Requiere UUID v4 → impacto bajo. Reproducido por lectura de SQL; la prueba estructural y de errores falla sin la migración. Las funciones **de proveedor** (`catalog_begin_import`, `catalog_upsert_*`, `catalog_propagate_fixtures`, `provider_*`) ya autorizan (`service_role`) antes de bloquear: no afectadas. | `20261017000100…:303` (`import_catalog_round`), `20261018000100…:223` (`import_catalog_teams`), `:280` (`set_tournament_results_mode`), `20261019000100…:142` (`publish_official_result`), `20260912000100_phase_05_admin_rpc.sql:9-13,20-24` (`approve_participant`, `set_participant_payment_status`) | **Corregido en migración propuesta** (6 funciones: leer sin bloqueo → autorizar → bloquear; «no existe» y «no autorizado» = `42501 not authorized`) | Data/RLS (aplicar) |
| F-01b | Baja | Mismo patrón en RPC de Fases 05/06/tickets no tocadas: `upsert_tournament`, `upsert_team`, `set_tournament_team`, `upsert_match`, `delete_match`, `set_pool_match`, `publish_pool_rules`, `enable_pool_tickets`, `configure_pool_round`. | `20261013000100_phase_06_sports_foundation.sql:170,194,287,306`; `20261016000100_tickets_stage1_free.sql:261`; `20260912000100…:41` | **Excepción justificada** hasta una migración mecánica posterior: mismo vector y severidad que F-01 (UUID v4, bloqueo breve, solo insiders), no son proveedor/catálogo ni finanzas. Revisar el 2026-11-15 | Data/RLS |
| F-02 | Baja | `updated_at` de `catalog_fixtures` y `catalog_seasons` avanzaba en **cada sondeo** (`last_polled_at` / `fixtures_synced_at` disparaban el trigger) y era legible: filtra la cadencia de sondeo (qué partidos sigue algún tenant con resultados automáticos — metadato cross-tenant) y además invalidaba innecesariamente el cursor de sincronización del cliente (`catalog-local.ts:43-76`). `fixtures_synced_at` era directamente legible. | `20261017000100…:77-82` (`tg_catalog_touch` siempre mueve `updated_at`), `:278,287` (sondeo), `:141-146` (grants) | **Corregido en migración propuesta**: trigger `tg_catalog_touch_relevant` (ignora columnas operativas) y `catalog_seasons` con SELECT por columnas sin `fixtures_synced_at` | Data/RLS |
| F-03 | Baja | `fixture_sync_log` sin retención; además `ignored_regression`/`conflict_manual_result` se insertaban en **cada** sondeo (cada 5 min en partidos en juego) → crecimiento sin cota. | `20261017000100…:113-122`; inserciones repetidas `20261019000100…:69,74` y `20261017000100…:393` | **Corregido en migración propuesta** (autorizada para QA por el propietario): `purge_fixture_sync_log(p_keep 180 d mín. 30, p_max_rows ≤ 100000, p_dry_run, p_keep_conflicts 365 d mín. 365)` → jsonb, solo `service_role`, con ejecución de prueba; las filas `conflict_manual_result` se conservan ≥ 365 d; registro append-only `maintenance_runs` (errores capturados con SQLSTATE); deduplicación 24 h; índice por `created_at`. Programarla sigue requiriendo autorización | Data/RLS (aplicar) · Release (programar) |
| F-07 | Baja | `anon` conserva `SELECT` de tabla en 22 tablas de `public` (incl. `participants`, `audit_log`, `profiles`, `predictions`, `tenant_memberships`); hoy solo la RLS (sin políticas para `anon`) impide leer. Defensa en profundidad inexistente. | Consulta de catálogo en QA (solo lectura): `role_table_grants` con `grantee='anon'`; `20261012000200…:19-20` solo revoca I/U/D | **Parcialmente corregido**: la migración revoca `SELECT` de `anon` en `participants` y `audit_log` (finanzas). Resto propuesto: revocar en todas tras comprobar que ningún flujo sin sesión las consulta | Data/RLS |
| F-08 | Baja | Flujo OAuth/recuperación `implicit` (tokens en el fragmento de la URL) y sesión en `localStorage` si «Recordar mi cuenta». Decisión consciente (ADR-013) con evaluación PKCE no ejecutada. | `apps/platform/src/lib/supabase.ts:14-17`; `docs/architecture/adr/ADR-013…:52-55` | **Excepción vigente** (ADR-013); depende de F-06 (CSP) | Frontend/Architect |
| F-09 | (era Alta) | `npm audit`: `source-map-js` 1.0.0–1.2.1 (GHSA-68fv-2mgg-jv7q, DoS por mapas fuente). Dependencia transitiva **solo de compilación** (vite/postcss/tailwind/jsdom); no se empaqueta en el cliente. | `package-lock.json` (entrada `node_modules/source-map-js`) | **Corregido en el lockfile** (1.2.2, rango compatible con `postcss ^1.2.1`). `npm audit` y `npm audit --omit=dev`: 0 vulnerabilidades. **`node_modules` no se reinstaló** (`npm update` falló por política de red; se editó la entrada del lock con hash oficial): ejecutar `npm ci` en la próxima sesión | Release |
| F-10 | Baja | Edge Functions: `request.json()` sin tope de cuerpo y `body = null` provoca 500 genérico (`sports-sync`); `branding-asset` solo limita por `Content-Length` (ausente en `chunked`, queda el límite de la plataforma). Sin fuga de datos (respuestas genéricas, logs sin PII). | `supabase/functions/sports-sync/index.ts:132`; `supabase/functions/branding-asset/index.ts:76-86,152` | Aceptado (bajo); endurecer al desplegar `sports-sync` | Backend |

## 3. Reevaluación de los tres hallazgos bajos del conector

1. **Orden bloqueo/autorización → F-01 / F-01b.** Confirmado en el código real. Los bloqueos son por fila, de duración de una RPC; no es DoS persistente. Corregido en las RPC de catálogo/resultados/pago; el resto queda como excepción con fecha de revisión.
2. **`updated_at` en cada sondeo → F-02.** Confirmado: el trigger `tg_catalog_touch` ignora qué columna cambió. Corregido; `last_polled_at` seguía oculto, ahora también `fixtures_synced_at`. El cursor del cliente (`updated_at`) solo avanza con cambios de contenido.
3. **Retención de `fixture_sync_log` → F-03.** Confirmado, agravado porque dos clases de fila se repetían en cada ciclo. Corregido con retención + deduplicación.

## 4. Auditoría de código (resultados)

- **Dependencias:** ver F-09. Antes: 1 alto (build-time), 0 críticos. Ahora 0/0 por lockfile.
- **Secretos:** patrones JWT, `sb_secret_`, `sbp_`, URL `postgres://usuario:clave@`, claves privadas PEM, AWS/Google, cabecera de proveedor: **0 coincidencias** en el árbol y en las 50 confirmaciones de todas las ramas (`git log --all -G`). Solo `.env.example` (raíz y `apps/platform`) están versionados; `.env`, `.env.*` y `.env.local` están ignorados. `service_role` / `SERVICE_ROLE` no aparece en `apps/platform`, `mobile` ni `.env.example`. (No se escanearon `.env` locales ignorados ni el historial remoto de GitHub.)
- **XSS:** 0 usos de `v-html`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, `document.write` en `apps/platform/src`.
- **Almacenamiento:** `localStorage`: clave de preferencia «recordar sesión» (booleano), token de sesión Supabase (solo con «recordar»; si no, `sessionStorage`), código de invitación opaco de 6 caracteres con TTL 24 h y limpieza al cerrar sesión (`join-intent.ts`), ids de equipos seguidos. IndexedDB (`offline-cache.ts`): espacio `public` sin PII y espacios `u:<usuario>[:t:<tenant>]` con TTL, tope de bytes/entradas y purga en `SIGNED_OUT` y cambio de usuario (`useAuth.ts:81-82,167`). Nunca se guardan credenciales. El service worker no intercepta orígenes de Supabase, rutas `/auth`, peticiones con `Authorization` ni respuestas `private/no-store` (`apps/platform/public/sw.js`). Observación: si `auth.signOut()` falla por red, la purga en `signOut()` no corre (sí corre al llegar `SIGNED_OUT`).
- **Redirecciones abiertas:** ninguna. Toda la navegación usa rutas con nombre (`router.push({ name })`); no hay parámetro `redirect`/`next`/`returnTo`; `emailRedirectTo` y `redirectTo` se construyen con `window.location.origin` fija + `/auth/callback`. Debe verificarse la lista de URLs permitidas en Supabase Auth (no verificable desde el repo).
- **Edge Functions:**
  - `sports-sync`: `verify_jwt=false` pero autentica por sí misma (JWT validado con `auth.getUser` + membresía admin vía RLS del propio usuario, o `x-sync-secret` comparado en tiempo constante; el modo programado solo permite `sync`). CORS por lista de orígenes (`CORS_ALLOWED_ORIGINS`), sin comodín; origen no permitido → 403. URL del proveedor **fija** (`https://v3.football.api-sports.io`), parámetros por `URLSearchParams`, ids de proveedor validados con `^[0-9]+$`, consulta 3–60 caracteres, año 1990–2100, tope de reintentos y cuota reservada antes de cada intento; la clave nunca se registra ni se devuelve; logs sin PII. Sin SSRF (no hay URLs controladas por el usuario). Hallazgos: F-05, F-10.
  - `branding-asset`: JWT obligatorio (`verify_jwt` por defecto), autorización delegada a RPC bajo la identidad del usuario, tamaño por `Content-Length` + `assertFileSize`, tipo real por cabecera mágica, dimensiones y reconversión a WebP, subida con `service_role` solo tras autorizar, errores genéricos y logs sin PII. Sin hallazgos nuevos (el hallazgo-001 previo sigue cerrado).
  - `branding-reconciler`: `verify_jwt=false`, secreto `BRANDING_RECONCILER_SECRET` en tiempo constante, solo POST, lotes de 50, sin entrada del cliente. Sin hallazgos.

## 5. Finanzas privadas (Encargo §5)

Superficie que toca el estado manual de pago (único dato financiero existente; ADR-014 sigue «Proposed»: no hay `payments`, ledger ni importes — la Etapa 1 de tickets es gratuita y `tickets`/`pool_rounds` no tienen columnas de pago, comprobado en F56):

| Superficie | Quién accede (código y catálogo QA) |
| --- | --- |
| `participants.payment_status` lectura | **Antes:** todo miembro del tenant (F-04). **Con la migración:** propia fila, admin del tenant, capacidad `finance` de esa quiniela |
| `participants` escritura directa | Nadie (sin I/U/D para `authenticated`/`anon`) |
| `set_participant_payment_status` | Solo `is_tenant_admin` del tenant **derivado de la fila** (nunca del cliente); `anon` sin EXECUTE; cambio auditado por trigger en `audit_log` |
| `audit_log` | Lectura solo admin del tenant; inmutable (I/U/D denegados); `anon` sin filas |
| Rankings (`pool_leaderboard`, `my_points_summary`, `my_pool_stats`, `pool_ticket_leaderboard`, `list_my_tickets`, `pool_points_evolution`) | Miembros/propio; **ninguno devuelve campos de pago** (F52); `my_points_summary` solo quinielas propias (F50) |
| Vistas / exportaciones | No existen vistas con `payment_status` (F54); el frontend no tiene exportaciones CSV de finanzas |
| `platform_admin` (ADR-008) | Sin política RLS ni RPC que le dé lectura/escritura de pagos del tenant; solo `register_platform_intervention` (audita). Verificado F12, F30, F45 |
| Personal `pool_finance` | Con la migración lee pagos solo de su quiniela; **no escribe** (la RPC exige admin del tenant): límite funcional de ADR-014 pendiente de la fase comercial (F31) |

## 6. Pruebas ejecutadas (QA, rollback, sin residuo; resultados exactos)

| Ejecución | Resultado |
| --- | --- |
| `finance-privacy.sql` **con** migración propuesta | **44/44 PASS** |
| `security-followups.sql` **con** migración propuesta (revisión con dry-run, `maintenance_runs`, conflictos 365 d) | **68/68 PASS** |
| `security-followups-down.sql` migración + down | **13/13 PASS** |
| `finance-privacy.sql` **sin** migración (línea base) | **38/44**: FAIL F06, F07, F09, F11b (lectura de pagos ajenos), F13b (privilegio `anon`), F26 (oráculo `22023`). Prueba que la suite detecta F-04/F-01/F-07 |
| `security-followups.sql` sin migración | ERROR esperado: `purge_fixture_sync_log` no existe (la suite exige la migración) |
| Regresión con la migración: `phase-sports-catalog` 71/71, `phase-catalog-seed-hybrid` 74/74, `phase-tickets-stage1` 72/72, `phase-08-leaderboard` 24/24, `phase-06-sports-foundation` 95/95 | **PASS (todas)** |
| Migración + `down` + `phase-catalog-seed-hybrid` (reversión) | 74/74 PASS (el `down` restaura el comportamiento previo) |
| `npm audit` / `npm audit --omit=dev` (tras editar el lock) | 0 vulnerabilidades / 0 vulnerabilidades (antes: 1 alta, build-time) |
| Consultas de solo lectura al catálogo de QA (políticas, privilegios de columna/tabla/función, tablas sin RLS) | Sin tablas sin RLS; sin EXECUTE de `anon` en funciones de `public` |

Notas de método: la prueba de «autorizar antes de bloquear» es **estructural** (posición de `is_tenant_admin` frente al primer `FOR UPDATE`) más la igualdad de errores; un bloqueo de fila revertido no es observable desde una sola sesión. La contención real requiere dos sesiones (clase C).

## 7. NO verificado

- Aplicación real de la migración propuesta en un entorno persistente y su efecto sobre sesiones concurrentes (solo rollback en QA).
- Contención de bloqueos con dos sesiones (F-01) y carga/volumen de `fixture_sync_log` real.
- `sports-sync`, `branding-asset`, `branding-reconciler` **desplegados**: se revisó solo el código (no se probó CORS, cabeceras ni secretos reales; no se verificó qué secretos y `verify_jwt` hay en la nube). Ninguna prueba contra el proveedor real en esta sesión.
- Si el alta de tenant es autoservicio (determina el alcance real de F-05).
- Configuración de Supabase Auth (URLs de redirección permitidas, confirmación de correo, límites de tasa, política de contraseñas), cuotas de la API, y la rotación/almacén de claves.
- Cabeceras HTTP reales de Vercel (sitio QA con desafío anti-bot), CSP funcional, wrapper Capacitor/Android/iOS (esquema de URL, almacenamiento nativo).
- Frontend en navegador autenticado tras F-04 (el cambio de RLS se contrastó contra el código fuente y suites SQL; falta UAT de `AdminView`/`PoolView`). Otros agentes modifican `apps/platform/src` en paralelo: no se revisaron esos cambios nuevos.
- `deno.lock` / dependencias de las Edge Functions (no hay `npm audit` para Deno); `fake-indexeddb` y paquetes de `node_modules` fuera del árbol analizado por `npm audit` en su versión instalada (`node_modules` sigue con `source-map-js` 1.2.1 hasta `npm ci`).
- Historial remoto de GitHub, `.env` locales ignorados y secretos en el panel de Vercel/Supabase.
- Fugas de PII en logs de plataforma (Supabase/Vercel) fuera del código.

## 8. Requiere autorización humana

1. **Aplicar** `supabase/proposed/20261022000100_security_followups.sql` (cambia RLS de `participants`, reduce visibilidad; añade nota a ADR-014/015 según AGENTS §12). Promover a `supabase/migrations/` y validar en QA con las suites de la sección 6 antes de producción.
2. **Decidir F-05** antes de desplegar `sports-sync` (restringir a `platform_admin` o cupo por usuario).
3. **Cabeceras de seguridad** en `vercel.json` (F-06; zona Release) y UAT con CSP en `Report-Only`.
4. Programar `purge_fixture_sync_log` (180 días) solo con autorización; ejecutar `npm ci` para materializar `source-map-js` 1.2.2.
5. Rotación de claves: **no se detectó exposición**; no se propone rotar nada.

## 9. Archivos

Nuevos: `reports/security/security-review-20261012.md`, `supabase/proposed/20261022000100_security_followups.sql`, `supabase/proposed/down/20261022000100_security_followups.down.sql`, `supabase/tests/security-followups.sql`, `supabase/tests/finance-privacy.sql`. Modificado: `package-lock.json` (3 líneas, `source-map-js` 1.2.1 → 1.2.2). `git diff --check` sin errores en los archivos propios.
