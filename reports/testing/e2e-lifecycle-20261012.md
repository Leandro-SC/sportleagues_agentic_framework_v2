# Prueba integral del ciclo de vida de una quiniela — Supabase QA (2026-10-12)

- Rama: `feat/api-football-connector`. Entorno: Supabase QA `juoftaofzepxbrrxbkhx` (migraciones `20261020`…`20261023` ya aplicadas).
- Script: `scripts/qa/e2e/full-lifecycle.mjs` (usa `scripts/qa/lib/qa-identities.mjs`). Comando: `QA_OWNER_AUTHORIZED=yes node scripts/qa/e2e/full-lifecycle.mjs`.
- Ejecuciones reales: **2** (límite acordado). Ejecución 1 `LIFE-79c250f5`: 143 PASS / 0 FAIL / 0 SKIPPED, código de salida 0. Ejecución 2 `LIFE-133d7ab8`: 128 PASS / 0 FAIL / 15 SKIPPED(already organizer), código de salida 0.
- Cuentas: solo las 5 identidades fijas (confirmado abajo). Claves de la CLI en memoria, nunca impresas ni guardadas; contraseñas aleatorias por ejecución, en memoria.
- Nada simulado: todo lo de usuario va por supabase-js con sesión (mismas RPC/RLS que la app). Con `service_role` solo se hizo: revisión de solicitudes (`review_pool_creation_request`), adelantar el inicio de un partido (`apply_fixture_update`, la entrada del sincronizador), `rebuild_team_ratings`, `purge_fixture_sync_log` (dry-run), `provider_access_check` (solo lectura) y lecturas de verificación (conteos, `scoring_events`, `stats_rating_runs`).

## 1. Resultado por paso (cada fila = lo realmente ejecutado)

Formato: ejecución 1 / ejecución 2. «n PASS» = aserciones individuales con código/valor observado en el log.

| Paso | Qué se verificó (evidencia observada) | Ej. 1 | Ej. 2 |
| --- | --- | --- | --- |
| 1 Cuentas | `qa-requester` con perfil y sin rol organizador; user1/user2/outsider sin rol organizador; `anon` no solicita (42501); nota de 501 caracteres -> `22023/note_too_long` | PASS (5) | PASS (4) + 1 SKIPPED (ya es organizador) |
| 2 Solicitud | 5 `request_pool_creation` en paralelo -> 1 sola pendiente, `created=true` exactamente 1 vez; UPDATE e INSERT directos -> 42501 y la fila sigue `pending`; `review_pool_creation_request` por API -> 42501; `qa-outsider` y `qa-admin-b` ven 0 filas de la solicitud; `pool_creation_request_events` ilegible (42501) | PASS (5) | PASS (1: `already_organizer` P0001) + 5 SKIPPED |
| 3 Operador | aprobación -> tenant `free` + membresía `owner`; repetir -> `created=false`, mismo tenant, 1 tenant con ese nombre y 1 membresía owner; rechazar una aprobada -> `P0001/already_reviewed`; eventos de auditoría requested=1, approved=1. `qa-user2`: solicita, operador rechaza (idempotente), aprobar la rechazada -> `already_reviewed`, nueva solicitud -> `P0001/cooldown_active`; `qa-user2` sin rol organizador. `qa-admin-b` obtiene su tenant por el mismo flujo | PASS (13) | PASS (4): sin duplicados (1 tenant, 1 aprobada), cooldown de `qa-user2` sigue activo (`retry_after=2026-10-19`), `qa-user2` no organizador; 7 SKIPPED |
| 4 Visibilidad del owner | ve 1 membresía (owner) y 1 tenant; lee su `audit_log` (incluye la aprobación); de `qa-admin-b`: auditoría 0, tickets 0, códigos 0, participantes solo propios; no crea quinielas en el tenant de B (42501) | PASS (4) | PASS (3) + 2 SKIPPED (la comprobación estricta no aplica: ya participó en B) |
| 5 Configuración | torneo, 3 equipos manuales + 2 selecciones del catálogo (`import_catalog_teams`: enrolled=2; repetir enrolled=0, ya inscritas=2), jornada, 4 partidos, quiniela con reglas 5/2 y aprobación, código de unión, `enable_pool_tickets` (1 jornada vendible, cupo 2); 2.ª quiniela activa en plan Free -> 22023; `lock_at = inicio − 15 min` en los 4 partidos; organizador B: torneo, equipos, partido, quiniela y código | PASS (8) | PASS (8); 2 quinielas previas archivadas |
| 6 Participantes | inscripción con código (pendiente), repetir idempotente; pendiente no emite ticket (42501); organizador se inscribe en SU quiniela -> `42501/ADMIN_PARTICIPANT_INCOMPATIBLE` (0 filas); B tampoco en la suya; aprobación (idempotente); outsider no pronostica (42501 ×2); **el organizador SÍ se inscribe, pronostica y es idempotente en la quiniela de qa-admin-b** y conserva su rol `owner`; como miembro de B no puede publicar resultados (42501) | PASS (12) | PASS (12) |
| 7 Auto-fill Elo+Poisson | pendiente -> `STATS_NOT_ELIGIBLE`; `rated=false` y modelo `elo-poisson-v1`, aviso «no es una certeza», 1X2 suma 1.000000, determinista; organizador -> `ADMIN_PARTICIPANT_INCOMPATIBLE`; outsider -> `22023/STATS_NOT_FOUND`; anon 42501; tras el cierre `42501/STATS_LOCKED`; usuario no reconstruye ratings (42501); `rebuild_team_ratings` (service_role) tras 2-1: X=1508.1507, Y=1491.8493 (igual al cálculo esperado K=20, ventaja 65), 2 reconstrucciones -> misma huella; partido posterior (revancha) `rated=true` con `ratings_as_of`; partidos sin historial (Y–Z, catálogo) `rated=false`; tras corregir a 0-0: X=1498.1507, Y=1501.8493, huella distinta y `lambda_home` 1.434732 -> 1.471052; **0 pronósticos auto-guardados** (predictions=8 manuales, `model_predictions`=0); usuario no escribe `team_ratings` (42501) | PASS (17) | PASS (17; `matches_processed` 2/2) |
| 8 Tickets y pronósticos | misma clave de idempotencia -> mismo ticket; 3.er ticket con cupo 2 -> `42501/TICKET_LIMIT`; 4 emisiones en paralelo de qa-user2 -> ok=2, TICKET_LIMIT=2; enviar sin selecciones -> 22023; cancelar sobrante idempotente; 8 selecciones; edición antes del cierre -> 1 fila con valor final; envío (submitted/eligible) idempotente; historial 1,2; ticket ajeno no escribible (42501) ni visible; user2 ve solo sus 2 selecciones; organizador y outsider ven 0; pronóstico clásico en quiniela con tickets -> 42501; organizador no emite ni escribe; participante no lee códigos de unión (0 filas) | PASS (15) | PASS (15) |
| 9 Cierre servidor | tras adelantar el inicio de m1: guardar (2 tickets) -> 42501; emitir y cancelar enviado -> 42501; clásico -> 42501; se revelan 3 pronósticos de m1 a un aprobado; los de m3 (abierto) siguen ocultos (ve 1, el propio); outsider ve 0; el cierre es por partido (m3 editable); publicar resultado de partido no iniciado -> 22023 | PASS (9) | PASS (9) |
| 10 Resultado y ranking | jugador no publica (42501); organizador publica 2-1 -> revisión 1, fuente manual; puntos [0,2,5]; ranking general `[1 user1 5, 2 user2 0]`, igual por jornada; ranking por ticket `[A 5 mejor, B 2, C 0 mejor]`; outsider 42501 en ambos; republicar mismo marcador -> sin duplicados (3 eventos); corrección a 0-0 -> revisión 2, 6 eventos (3+3), puntos rev. 2 [0,0,5], 0 duplicados; revisión obsoleta -> `PT409`; repetir corrección -> 6 eventos; ranking final `[1 user2 5, 2 user1 0]` y por ticket coherente | PASS (13) | PASS (13) |
| 11 Estadísticas | user1 rev. 1: rango 1, 5 pts, 1 exacto, resumen y evolución [5; media 2.5]; final user1: rango 2/2, 0 pts, evolución [0,0,2.5], 2 tickets (1 mejor); user2: rango 1/2, 5 pts, 1 exacto, evolución [5,5,2.5], 2 tickets (1 cancelado, 1 mejor); organizador sin estadísticas de jugador en su quiniela; outsider 0 filas y `my_pool_stats` 42501 | PASS (5) | PASS (5) |
| 12 Pagos y aislamiento | organizador lee los 2 participantes bajo RLS: `{invited:2}` -> tras `set_participant_payment_status` `{paid:1,pending:1}`; jugador no cambia pagos ni aprueba (42501 ×3); qa-user1 ve solo su fila (ej. 2: 2 filas propias en total, 1 en esta quiniela) y no la de user2; qa-admin-b: lecturas directas (participants, tickets, predictions, pools/pool_matches/matches/official_results) 0 filas, UPDATE directo 42501, y las RPC `set_participant_payment_status`, `approve_participant`, `suggest_scoreline` (`22023/STATS_NOT_FOUND`), `publish_official_result`, `import_catalog_teams`, `save_ticket_prediction`, `create_ticket`, `create_pool_join_code`, `manage_pool`, `enable_pool_tickets`, `upsert_tournament`, `pool_leaderboard` -> **17/17 denegados**; el estado de pago no cambió (BD); participante raso -> admin RPC 42501 ×4; organizador en B no administra B (42501 ×2); qa-admin-b sí ve la participación de qa-requester en SU quiniela | PASS (27) | PASS (27) |
| 13 purge dry-run | `ok:true, dry_run:true, would_delete:0`; `maintenance_runs` 3->4 (ej. 2: 4->5) con `dry_run=true, affected=0, error=null`; `fixture_sync_log` 0->0; participante y organizador 42501; `maintenance_runs` ilegible (42501) | PASS (4) | PASS (4) |
| 14 provider_reserve | denegada (42501) a participante, organizador, ajeno, organizador B y anon; `provider_settle`, `provider_quota_purge`, `provider_access_check` 42501; tablas de cuota ilegibles (42501 ×4); contadores `provider_usage` sin cambios (0->0); lectura como service_role: presupuesto 80/día, 2400/mes, reserva 8; `provider_access_check` -> catálogo `OK`, sondeo `AUTO_RESULTS_OFF`, tenant Free `AUTO_RESULTS_OFF`. **`provider_reserve` NO se ejecutó como service_role.** | PASS (6) | PASS (6) |

## 2. Idempotencia y re-ejecución (ejecución 2)

- `qa-requester` ya era organizador: `request_pool_creation` -> `P0001/already_organizer` (PASS) y los pasos 2–4 de solicitud/aprobación quedaron `SKIPPED(already organizer)` (15 aserciones), no PASS. Se comprobó que no hubo duplicados: 1 tenant propio y 1 solicitud aprobada.
- Cooldown de `qa-user2`: el rechazo de la ejecución 1 seguía activo (`P0001/cooldown_active`, `retry_after=2026-10-19`); no se creó otra solicitud.
- Las quinielas Free de la ejecución 1 se archivaron (plan Free = 1 activa) y se creó una nueva sin colisiones; `qa-user1`/`qa-user2`/`qa-requester` se inscribieron en las quinielas nuevas del mismo tenant sin duplicar filas.

## 3. Defectos de producto

**Ninguno encontrado en lo ejecutado** (0 FAIL en 2 ejecuciones). No se editó ninguna migración, función ni código de `apps/platform`.

Observaciones (no son fallos; decisiones de diseño a confirmar por el propietario):

1. **El organizador no puede leer pronósticos revelados tras el lock** (paso 9.7: ve 0 filas de `predictions` en un partido ya cerrado). La RLS `can_read_prediction` exige participación aprobada. Coherente con ADR-015 (el organizador no compite ni espía), pero implica que cualquier vista «auditoría de pronósticos» del organizador necesitaría una RPC dedicada.
2. El cierre es **por partido**: tras cerrarse el primer partido de la jornada, `create_ticket`/`cancel_ticket` se bloquean para toda la jornada, pero un ticket ya enviado sigue editable en los partidos todavía abiertos (m3 aceptó edición, paso 9.8). Es el comportamiento documentado (lock por partido; venta por primer lock de la jornada).
3. Los mensajes de permisos denegados de PostgREST incluyen una pista `Grant the required privileges ... GRANT UPDATE ON public.<tabla> TO authenticated;` (visible en `error.hint`). Es el comportamiento por defecto de PostgREST: revela nombres de tablas ya conocidos, no abre acceso. Informativo.
4. Un participante de tenant ve únicamente sus filas de `participants` y no lee `pool_join_codes` (confirmado: 0 filas), consistente con F-04 y R5.

## 4. Límites de la prueba (no afirmado)

- `NOT_RUN(browser)`: toda experiencia de UI (formularios de solicitud, vistas móviles, flyers, PWA/Capacitor, compartir), temporizadores en pantalla y estados vacíos visuales. No se ejecutó ningún paso de navegador.
- El inicio del partido se **adelantó** con `apply_fixture_update` (service_role, entrada del sincronizador) en lugar de esperar al reloj real; el cierre que se verifica es el del servidor/BD al detectar `clock_timestamp() >= lock_at`.
- Concurrencia real solo en: 5 solicitudes simultáneas (paso 2) y 4 emisiones de tickets simultáneas (paso 8). No se repitió la batería de carga de `tickets-flow.mjs`/`concurrency.mjs`.
- Un solo resultado oficial y una jornada por ejecución; no se probaron múltiples jornadas, desempates por rachas ni resultados del proveedor/Premium (`auto_results` apagado).
- Los ratings se comprobaron con 1 partido jugado (valores analíticos verificados) y los equipos del catálogo no tienen historial (`rated=false`).
- Pagos: solo el estado manual (`paid`/`pending`/`invited`); no hay dinero en el MVP.
- `provider_reserve` y el resto de funciones de cuota solo se probaron como **denegadas** a usuarios; la reserva real (como service_role) no se ejecutó por instrucción.

## 5. Residuo creado

Detalle y totales en `docs/operations/QA-SYNTHETIC-RESIDUE.md` (sección «Identidades fijas y prueba integral»). Resumen verificado por conteo tras las 2 ejecuciones:

- Cuentas de Auth: 5 (únicas, ver §6). Perfiles `qa-*`: exactamente 5 (`qa-admin-b`, `qa-outsider`, `qa-requester`, `qa-user1`, `qa-user2`).
- Tenants: 2 (`LIFE-79c250f5` y `LIFE-79c250f5-B`, ambos plan free, creados por solicitud + aprobación del operador). La ejecución 2 no creó ninguno.
- Quinielas `LIFE-*`: 4 (2 archivadas, 2 abiertas); torneos 4; equipos manuales 10 (+2 selecciones de catálogo vinculadas); 10 `pool_matches`; participaciones 6; tickets 8 (2 cancelados); pronósticos 18.
- `pool_creation_requests` (toda la tabla): 2 aprobadas + 1 rechazada (la de `qa-user2`, cooldown hasta 2026-10-19).
- `maintenance_runs` (`purge_fixture_sync_log`): +2 filas dry-run (total 5 en QA, 3 previas).
- Lo anterior es append-only/no borrable por diseño; no se intentó borrar nada.

## 6. Confirmación de identidades

Se usaron **solo** `qa-requester@example.test`, `qa-admin-b@example.test`, `qa-user1@example.test`, `qa-user2@example.test`, `qa-outsider@example.test`, creadas por `ensureQaIdentities()` en la ejecución 1 (cuenta confirmada + perfil) y reutilizadas en la 2 con contraseña nueva aleatoria (API admin, en memoria). El módulo localiza cada cuenta por `profiles.display_name` y verifica el correo con `auth.admin.getUserById`; no lista ni consulta `auth.users` ni lee datos de personas reales. No se creó ninguna otra cuenta.

## 7. Archivos

- Nuevos: `scripts/qa/lib/qa-identities.mjs`, `scripts/qa/e2e/full-lifecycle.mjs`, `reports/testing/e2e-lifecycle-20261012.md`.
- Editado (solo añadido): `docs/operations/QA-SYNTHETIC-RESIDUE.md`.
- No commit. `git diff --check` sin hallazgos en el archivo de documentación editado.

## 8. API de `qa-identities.mjs` para el UAT de navegador

`const { env, svc, identities } = await ensureQaIdentities()` con `QA_OWNER_AUTHORIZED=yes`. `identities.{requester,adminB,user1,user2,outsider}` exponen `{ email, id, client, signIn() }` y una propiedad **no enumerable** `password` (solo memoria; no escribirla en archivos, capturas ni logs). Cada llamada fija contraseñas nuevas: no ejecutar a la vez que otra prueba que use las mismas cuentas. Documentación completa en la cabecera del módulo.
