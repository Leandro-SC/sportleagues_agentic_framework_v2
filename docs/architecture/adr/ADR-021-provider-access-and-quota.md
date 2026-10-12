# ADR-021 — Acceso y cuota del proveedor deportivo (`sports-sync`)

- Estado: **Accepted** (2026-10-12, por decisión del propietario: restricción a procesos backend autorizados y límites definitivos Free 0; Pro 20 solicitudes/día y 300/mes por tenant; GLOBAL 80/día y 2 400/mes). Migración en `supabase/proposed/20261023000100_provider_access_and_quota.sql` (+ `down/`); **aceptada la decisión; la aplicación a QA/producción y el despliegue de la función siguen requiriendo autorización expresa y no se han hecho**.
- Origen: hallazgo **F-05** (y F-10) de `reports/security/security-review-20261012.md`, con **decisión aprobada por el propietario**: «`sports-sync` debe ser ejecutada exclusivamente por procesos backend autorizados de la plataforma. No permitir que cualquier administrador de tenant invoque directamente operaciones que consuman cuota del proveedor.»
- Relacionados: ADR-016 (catálogo y conector), ADR-006 (entitlements en servidor), ADR-008/ADR-018 (superadmin fuera de la app principal), AGENTS.md §5 y §12.
- Impacto AGENTS.md §12: cambia la autorización de una función (auth), añade esquema (contadores de cuota con `tenant_id`) y fija el modelo de cuota por plan del proveedor externo. Requiere aceptación antes de aplicar.

## Contexto

`sports-sync` autorizaba `search` e `import_season` a cualquier propietario/administrador de **cualquier** tenant (JWT + membresía) y la cuota solo tenía un tope diario **global** (`provider_consume`), sin tope por usuario ni por tenant. Un administrador malicioso podía agotar la cuota compartida y degradar el proveedor para todos. La función no está desplegada y `auto_results` está apagado, por lo que el riesgo era latente; el hallazgo bloqueaba el despliegue. Además `request.json()` no tenía tope de cuerpo (F-10).

## Decisión

### 1. Autorización: solo credencial interna de plataforma

- La única credencial aceptada es el secreto de entorno `SPORTS_SYNC_SECRET` en la cabecera `x-sync-secret`, comparado en tiempo constante (SHA-256 + XOR; mismo patrón que `branding-reconciler`). Se exige longitud ≥ 32; si falta o es corta la función **falla cerrado** (401 a todos).
- Un JWT de usuario —administrador de tenant incluido— **nunca autoriza** ninguna acción: una petición con `Authorization` y sin secreto válido recibe **403** sin validar el JWT ni consultar la base de datos; sin ninguna credencial, **401**. Se eliminan de la función `auth.getUser`, la lectura de `tenant_memberships` y `SUPABASE_ANON_KEY`. No se introduce el rol Superadmin en la interfaz principal.
- Sin CORS: es una llamada servidor-a-servidor. Una petición con `Origin` se rechaza (403) y nunca se emiten cabeceras `access-control-*`.
- Entrada acotada (F-10): solo `POST`; `Content-Type: application/json`; cuerpo máximo **2 048 bytes** (por `Content-Length` declarado **y** por conteo de bytes en flujo, cancelando la lectura); JSON estricto con lista cerrada de claves (`action`, `query`, `competition`, `year`, `tenant_id`) y tipos exactos. Errores genéricos con `request_id`; excepciones internas jamás devuelven ni registran su mensaje.
- Orden: método → origen → **autenticación** → tipo/tamaño/esquema → apertura del cliente privilegiado → **comprobación de acceso** → reserva de cuota por intento → llamada al proveedor. La service-role y la clave del proveedor solo se tocan después de autenticar y validar.

### 2. Atribución al tenant (no es autorización)

Las operaciones de catálogo (`search`, `import_season`) aceptan un `tenant_id` **opcional** que informa el proceso backend de confianza solo para **atribuir el consumo al cupo de ese tenant**. No autoriza acceso a datos del tenant (las funciones de catálogo no leen ni escriben datos tenant-owned) y la base de datos **valida** que el tenant exista y **deriva su plan** de `tenant_entitlements`; nunca se confía en un plan o permiso enviado en la petición. Sin `tenant_id` el consumo es de **ámbito plataforma** (solo presupuesto global). `sync` es siempre de plataforma (un único sondeo `live=all` sirve a todos los tenants; `tenant_id` con `sync` es una petición inválida).

### 3. Cuotas atómicas en SQL

Funciones `SECURITY DEFINER` con `search_path` vacío, guarda interna `auth.role() = 'service_role'` (como `rebuild_team_ratings`) y `REVOKE` a `public/anon/authenticated`; la función interna `_provider_tenant_access` no la ejecuta ni `service_role`.

- `provider_quota_config(provider, daily_limit, monthly_limit, sync_reserve)`: presupuesto **global** del proveedor. Límites definitivos del propietario para `api_football`: **80/día**, **2 400/mes** (margen bajo las 100/día del plan gratuito del proveedor) y **reserva de sondeo 8** = 10 % del diario, la misma proporción que la anterior 10/100: el catálogo llega a 72/día, `sync` puede usar las 80 y la reserva (8) es estrictamente menor que el global; basta para ~8 sondeos `live=all` al día, suficientes porque el sondeo gratuito es una sola solicitud por ciclo Las operaciones de catálogo solo pueden usar `daily_limit − sync_reserve`; `sync` puede usar el límite completo. El entorno (`API_FOOTBALL_DAILY_LIMIT`) solo puede **restar** presupuesto (`p_daily_cap`), nunca ampliarlo.
- `plan_provider_quota(provider, plan_code, daily_requests, monthly_requests)`: presupuesto **por tenant según plan**. Valores definitivos del propietario: **free = 0/0** (sin acceso al proveedor), **pro = 20/día y 300/mes** por tenant. Los ajusta el operador con `service_role` sin migración, pero cualquier cambio es decisión del propietario.
- Contadores: global diario = `provider_usage.requests` (única fuente de verdad, ya existente), `provider_usage_monthly` (global mensual) y `provider_tenant_usage` (tenant × día/mes; tabla tenant-owned con RLS activa, sin políticas ni privilegios para clientes: ni el administrador del tenant la lee).
- `provider_reserve(provider, kind, tenant, n, daily_cap)` reserva **atómicamente** los cuatro contadores o ninguno: bloqueo asesor de transacción por proveedor (mismo orden de bloqueo en reservas y liquidaciones: sin interbloqueos), `SELECT … FOR UPDATE` de cada contador, comprobación y `UPDATE … WHERE requests + n <= límite` exigiendo exactamente una fila (si se rompe la invariante, la transacción entera aborta). Devuelve `allowed`, motivo, `reservation_id` y cupos restantes. Motivos: `PROVIDER_NOT_CONFIGURED`, `TENANT_UNKNOWN`, `AUTO_RESULTS_OFF`, `PLAN_NO_ACCESS`, `GLOBAL_EXHAUSTED`, `GLOBAL_MONTH_EXHAUSTED`, `TENANT_EXHAUSTED`, `TENANT_MONTH_EXHAUSTED`. Una reserva `n>1` se concede entera o se rechaza entera.
- Acceso por ámbito (`_provider_tenant_access`): ámbito tenant exige entitlement existente, `platform_feature_flags.auto_results = true` y plan `pro` con cupo > 0 (misma regla que `_auto_results_allowed`, con motivo diferenciado). Ámbito plataforma: `sync` exige `auto_results` encendido; `search`/`import_season` (mantenimiento de catálogo) solo consumen presupuesto global. **`auto_results` sigue apagado** (la migración no toca la bandera) y un tenant FREE queda sin acceso.
- `provider_access_check` (solo lectura) permite rechazar **antes** de abrir trabajos de importación o llamar al proveedor.

### 4. Registro de consumo y errores

`provider_quota_reservations` registra una fila por solicitud HTTP reservada (proveedor, tipo, tenant, n, estado, código corto `^[A-Z0-9_]{1,60}$` y marcas de tiempo): **sin PII, sin cuerpos de respuesta del proveedor y sin texto libre** (un código que no cumpla el patrón se descarta). Los rechazos no generan fila: se cuentan en `provider_tenant_usage.rejected` o `provider_usage.quota_rejected` (acotado por día). Los errores por tenant se cuentan en `provider_tenant_usage.errors`; los globales siguen en `provider_usage.errors/rate_limited` (`provider_record_outcome`). `provider_quota_purge` (solo `service_role`) marca `UNSETTLED` las reservas sin liquidar tras 1 h (siguen contando) y borra las liquidadas con más de 90 días (mínimo 30); **su programación no se activa sin autorización**.

### 5. Criterio de liquidación (ajustar/liberar)

Cada reserva se liquida al terminar la operación con `provider_settle` (**idempotente**: solo transiciona desde `reserved`; repetir o liquidar una reserva ya liquidada/inexistente devuelve `false` sin tocar contadores, sin doble devolución):

- Operación correcta → `consumed`.
- Operación fallida (429, 5xx, red, error propio) → `failed` con el código: el intento **salió** y el proveedor puede haberlo contado, por lo que **no se devuelve cuota**.
- `QUOTA_EXHAUSTED` en medio de una operación → los intentos anteriores ya salieron: `consumed`.
- `released` (devuelve cuota a los cuatro contadores, en el periodo de la reserva) queda reservado para reservas que **demostrablemente no emitieron** la solicitud (aborto tras reservar, operador). La Edge Function no libera automáticamente en ningún camino actual (la reserva ocurre inmediatamente antes de `fetch`). Si liquidar falla, la reserva sigue contando: el error cae siempre del lado conservador.

### 6. Lo que no cambia

`provider_consume` (heredado, solo `service_role`) permanece; la función deja de usarlo. El contador mensual global y el por tenant **no** incluyen consumo hecho por esa ruta heredada: nadie debe llamarla (hay una prueba estática que lo vigila en la función). Resultados manuales, scoring, pronósticos y RLS de tenants no se tocan.

## Alternativas consideradas

- **Restringir a `platform_admin`** (opción del informe): introduce el rol Superadmin en la interfaz/flujo principal (contradice ADR-018) y deja invocación humana directa del proveedor; descartado por la decisión del propietario.
- **Tope diario por `requested_by`** en `catalog_import_jobs`: limita al usuario pero mantiene la invocación por administradores de tenant y no cubre el plan; descartado.
- **Contadores solo en memoria/Edge**: no son atómicos entre instancias; descartado.

## Consecuencias

- Hoy ningún flujo de la app invoca `sports-sync` (no se encontró uso en `apps/platform/src`; verificar antes de desplegar): el cambio no rompe UI.
- Un proceso backend futuro que actúe «por un tenant» deberá guardar su propio secreto y decidir el `tenant_id` con su propia autorización (p. ej. aprobación del operador, ADR-017); esta ADR no define ese proceso.
- El `tenant_id` lo aporta un llamador de confianza: si el secreto se filtra, un atacante podría **atribuir** consumo a un tenant ajeno (agotando su cupo) pero no leer ni escribir datos del tenant. Mitigación: rotación del secreto, topes globales y por tenant, y `quota_rejected`/`rejected` para detectarlo.
- Los límites (free 0/0, pro 20/300; global 80/2 400, reserva 8) son definitivos por decisión del propietario; no hay uso real que los contraste: conviene revisarlos con datos antes de activar `auto_results`. Con 80/día y 20/día por tenant pro, 4 tenants pro agotan el presupuesto interactivo (72); el tope global es el respaldo.

## Verificación

- SQL (rollback en QA): `supabase/tests/provider-access-quota.sql` — ver el informe de la entrega para el resultado exacto. Cubre privilegios y guarda interna (owner/admin/miembro/platform_admin/anon denegados en funciones y tablas), contador exacto bajo reservas sucesivas, plan FREE, `auto_results` apagado, presupuesto global agotado con cupo de tenant intacto, topes mensuales, aislamiento entre tenants, reserva de sondeo, `p_daily_cap`, validaciones, liberación/ajuste idempotentes y retención.
- Vitest: `apps/platform/src/lib/sports-sync-access.test.ts` (manejador, almacén y orden «reserva antes de llamar»).
- **Pendiente (clase C):** concurrencia real entre dos sesiones simultáneas contra el contador; despliegue real de la función (secretos, `verify_jwt=false`, cabeceras); prueba contra el proveedor real; validación de los límites con uso real.

## Rollback

`supabase/proposed/down/20261023000100_provider_access_and_quota.down.sql` elimina solo los objetos de esta migración (verificado en rollback: migración + down deja 0 objetos nuevos y conserva `provider_usage`, `provider_consume`, `provider_record_outcome` y la bandera apagada). Tras revertir, la función debe permanecer sin desplegar o volver a usar `provider_consume`.
