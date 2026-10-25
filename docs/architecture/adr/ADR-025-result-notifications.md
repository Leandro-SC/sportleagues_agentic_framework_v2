# ADR-025 — Notificaciones de resultados dentro de la app

- Estado: **Accepted para QA** (2026-10-24, pedido explícito del propietario). Migración `supabase/migrations/20261024000300_result_notifications.sql`, aplicada en QA (31/31); reversión en `supabase/proposed/down/20261024000300_result_notifications.down.sql`.
- Relacionados: ADR-012 (revisiones de resultados), ADR-015 (quién compite), ADR-020 (privacidad de participantes), ADR-023 (reglas congeladas). Sustituye el punto de entrada vacío de notificaciones de la Fase 11.
- Impacto AGENTS.md §12: tabla nueva con `profile_id` (datos personales mínimos: título y texto del aviso) y una función nueva de API.

## Contexto

El propietario pidió avisar a los usuarios cuando cambie un resultado. No había notificaciones: `NotificationsButton` solo mostraba un estado vacío.

## Decisión

1. **Origen en la base de datos.** Un trigger `AFTER INSERT OR UPDATE OF home_score, away_score, revision` en `official_results` crea un aviso por jugador inscrito en cada quiniela no borrador que incluye el partido.
   - Se avisa a los jugadores aprobados y no retirados; no se avisa a pendientes, retirados, organizadores ni ajenos.
   - Cubre tanto la publicación manual como la del proveedor.
   - `result_published` en la primera publicación y `result_corrected` en las correcciones.
   - Un cambio sin efecto en el marcador no notifica. La clave única (jugador, quiniela, partido, revisión) evita duplicados, también al republicar.
2. **Contenido.** El título lleva el marcador oficial con los nombres de los equipos. El cuerpo lleva el nombre de la quiniela y **solo el pronóstico propio** con los puntos según la regla vigente (congelada tras el primer lock, ADR-023). En quinielas con tickets dice «Revisa los puntos de tus tickets».
3. **Acceso.** RLS: cada usuario lee solo sus avisos; `anon` no tiene acceso y nadie inserta, modifica ni borra directamente. `mark_notifications_read(ids|null)` solo marca avisos propios. `purge_read_notifications` (solo `service_role`, mínimo 30 días, por defecto 180) aplica la retención de los avisos leídos.
4. **Entrega en la app.**
   - La campana muestra el contador de no leídos, la lista, «Marcar todo como leído» y, al tocar un aviso, lleva a la quiniela.
   - Tiempo real con Supabase Realtime (la tabla está en `supabase_realtime` y respeta RLS), con sondeo de respaldo cada 2 minutos y al volver a la pestaña.

## Alternativas descartadas / pendientes

- **Push del sistema operativo (Web Push con VAPID para la PWA, FCM para Android):** requiere claves, un proceso emisor, almacenar tokens de dispositivo (datos personales) y, para Android, un proyecto Firebase del propietario. Queda como etapa 2 con su propio ADR. Esta tabla será su fuente.
- **Generar los avisos desde el cliente o desde una Edge Function:** un trigger es atómico con el resultado y no depende de que el organizador tenga la app abierta.

## Evidencia

`result-notifications.sql` 19/19 en rollback. Regresión de 12 suites relacionadas con resultados (870 casos) en verde con la migración. Pruebas unitarias del composable (carga, tiempo real sin duplicados, marcar como leído con reversión ante error, cierre de sesión).
