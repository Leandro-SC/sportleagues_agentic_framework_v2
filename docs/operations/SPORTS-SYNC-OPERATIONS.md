# `sports-sync` — operación (ADR-016 + ADR-021)

Estado: **no desplegada y no programada**. `auto_results` está **apagado**. Este documento describe cómo operarla cuando el propietario autorice activarla. Ningún valor secreto vive en este repositorio.

## Quién puede invocarla

Solo **procesos backend autorizados de la plataforma** con el secreto interno. Ningún usuario de tenant (propietario/administrador incluido), ni `platform_admin` desde la app, la invoca; un JWT de usuario recibe **403** sin consultar nada. La función no tiene CORS.

| Dato | Valor |
| --- | --- |
| Método / tipo | `POST`, `Content-Type: application/json`, cuerpo ≤ 2 048 bytes |
| Credencial | cabecera `x-sync-secret: <SPORTS_SYNC_SECRET>` (≥ 32 caracteres) |
| `verify_jwt` | `false` en `supabase/config.toml` (la función se autentica sola con el secreto) |
| Acciones | `{"action":"search","query":"…","tenant_id":"<uuid opcional>"}` · `{"action":"import_season","competition":"39","year":2023,"tenant_id":"<uuid opcional>"}` · `{"action":"sync"}` |

`tenant_id` es solo **atribución del consumo** al cupo de ese tenant (la base de datos valida que exista y deriva su plan). `sync` es siempre de plataforma.

Códigos: 200 (`ok`/`fresh`/`in_progress`/`degraded` con `code` y, si aplica, `quota_reason`), 400 esquema/JSON, 401 sin credencial o secreto incorrecto, 403 credencial de usuario / origen / acceso denegado (`PLAN_NO_ACCESS`, `AUTO_RESULTS_OFF`, `TENANT_UNKNOWN`), 413 cuerpo grande, 415 tipo, 405 método, 429 cuota agotada (`GLOBAL_*`, `TENANT_*`), 503 proveedor sin configuración de cuota, 500 error interno genérico.

## Secretos (nombres; solo entorno seguro de la función)

- `SPORTS_SYNC_SECRET` — secreto interno de invocación. Distinto de cualquier otro; ≥ 32 caracteres aleatorios. Lo guarda únicamente el proceso backend que llama.
- `API_FOOTBALL_KEY` — clave del proveedor. Nunca se devuelve ni se registra.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — los inyecta Supabase en la función; la service-role no existe en el frontend.
- Opcionales: `API_FOOTBALL_PLAN` (`free`/`paid`), `API_FOOTBALL_DAILY_LIMIT` (solo puede **restar** presupuesto; manda la base de datos).
- Eliminados: `CORS_ALLOWED_ORIGINS`, `SUPABASE_ANON_KEY` (ya no se usan).

Rotación: generar un secreto nuevo, actualizarlo en el secreto de la función y en el proceso llamador en la misma ventana; no hay periodo de doble secreto (el viejo deja de valer de inmediato). Ante sospecha de filtración: rotar y revisar `provider_tenant_usage.rejected`, `provider_usage.quota_rejected` y `provider_quota_reservations` por consumo inesperado.

## Presupuestos (límites definitivos fijados por el propietario)

Se administran con `service_role`/postgres, sin migración. Nunca desde la app.

- Global (`provider_quota_config`): `api_football` **80/día, 2 400/mes**, reserva de sondeo **8** (10 % del diario; el catálogo llega a 72/día y `sync` puede usar las 80). Límites definitivos fijados por el propietario.
- Por plan (`plan_provider_quota`): `free` 0/0 (sin acceso), `pro` 20/día y 300/mes por tenant.

Ajuste (ejemplo; ejecutar solo con autorización, p. ej. desde `supabase db query` con credenciales del operador):

```sql
update public.plan_provider_quota set daily_requests = 30, monthly_requests = 400 where provider = 'api_football' and plan_code = 'pro';
update public.provider_quota_config set daily_limit = 80, monthly_limit = 2400, sync_reserve = 8 where provider = 'api_football';
```

Reglas: `monthly >= daily` y `sync_reserve < daily_limit` (restricciones de tabla). Un proveedor sin fila en `provider_quota_config` **falla cerrado** (`PROVIDER_NOT_CONFIGURED`).

## Monitorización (solo lectura, `service_role`)

```sql
select day, requests, errors, rate_limited, quota_rejected from public.provider_usage where provider = 'api_football' order by day desc limit 14;
select month, requests from public.provider_usage_monthly where provider = 'api_football' order by month desc limit 6;
select tenant_id, period, period_start, requests, errors, rejected from public.provider_tenant_usage where provider = 'api_football' order by period_start desc, requests desc limit 50;
select status, count(*) from public.provider_quota_reservations where created_at > now() - interval '1 day' group by 1;
```

Señales: `quota_rejected`/`rejected` crecientes = alguien pide por encima del cupo (revisar el proceso llamador); reservas `failed/UNSETTLED` = procesos caídos a mitad de operación (siguen contando; es conservador); `errors`/`rate_limited` altos = problema del proveedor (ADR-016).

## Retención

`provider_quota_purge()` (solo `service_role`): marca `UNSETTLED` las reservas sin liquidar tras 1 h y borra liquidadas con más de 90 días (mínimo configurable 30). **No se programa** sin autorización; igual que `purge_fixture_sync_log` (F-03).

## Criterio de cuota (resumen de ADR-021 §5)

Cada intento HTTP reserva antes de salir. Tras un intento emitido **no se devuelve cuota** aunque falle (el proveedor puede contarlo). `released` solo para reservas que no emitieron la solicitud. Si el proceso muere sin liquidar, la reserva sigue contando.

## Lista de comprobación antes de desplegar (requiere autorización del propietario)

1. ADR-021 aceptado; migración `20261023000100` promovida a `supabase/migrations/` y aplicada en QA, con `supabase/tests/provider-access-quota.sql` en verde (y reproducida la suite completa de regresión del catálogo).
2. Límites definitivos del propietario aplicados (Free 0; Pro 20/día y 300/mes por tenant; global 80/día y 2 400/mes, reserva 8). Cualquier cambio posterior es decisión del propietario.
3. Definir el proceso backend llamador y su almacén de secretos; confirmar que ningún flujo de la app invoca `sports-sync` (`grep` en `apps/platform/src`).
4. Configurar secretos de la función (sección anterior) y comprobar `verify_jwt = false` en la nube; actualizar el comentario de `[functions.sports-sync]` en `supabase/config.toml` (aún habla de «JWT de administrador»).
5. Prueba de humo en QA con tráfico sintético: 401 sin secreto, 403 con JWT de usuario, 413/415/405, 429 al agotar el cupo, `AUTO_RESULTS_OFF` con la bandera apagada. Prueba de concurrencia real con dos sesiones (clase C) sobre el contador.
6. Solo entonces encender `auto_results` y programar `sync`; ambos requieren autorización aparte.

## Limitaciones conocidas

- La concurrencia real entre sesiones no se ha probado (solo reservas sucesivas en rollback y revisión estructural del bloqueo).
- No se ha probado contra el proveedor real ni con la función desplegada.
- La ruta heredada `provider_consume` sigue existiendo (solo `service_role`) y no suma al contador mensual ni al del tenant; la función no la usa.
- `tenant_id` lo informa un llamador de confianza (atribución, no autorización): una filtración del secreto permitiría agotar el cupo de un tenant, no leer sus datos.
