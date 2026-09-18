# ADR-007 - Lifecycle privado de imagenes de branding

- Estado: Accepted
- Fecha: 2026-09-15
- Decisores: Architecture, Data/RLS y Frontend/Admin UX

## Contexto

El MVP requiere logo, colores y banner para tenants PRO en la Fase 05. ADR-006 ya fija que los assets son privados, tenant-scoped y validados server-side. La base actual incluye `tenant_branding`, `branding_assets` y el bucket privado `branding-assets`, pero no define el lifecycle de imagenes ni una operacion segura de carga. Ademas, existe una contradiccion: `branding_assets.storage_path` exige `{tenant_uuid}/{asset_uuid}`, mientras que las policies actuales aceptan tipos segun extension.

## Problema

El MIME declarado por el navegador, el nombre del archivo y las dimensiones leidas por el cliente no son pruebas de que el binario sea una imagen permitida. Las policies de Storage pueden autorizar objetos por bucket, path y JWT; PostgreSQL/RPC puede validar tenant, rol, entitlement y metadata. Ninguna de esas capas, por si sola, inspecciona de forma fiable firma binaria, MIME real o dimensiones. Tampoco existe una transaccion unica que abarque Storage y PostgreSQL, por lo que reemplazar o eliminar assets necesita estados recuperables.

## Decision

### Storage y path

Se conserva un unico bucket privado `branding-assets` y el contrato definitivo de nombre es:

```text
{tenant_uuid}/{asset_uuid}
```

No se incorpora una extension, nombre original ni `tenant/` adicional. El UUID de asset se genera server-side; `tenant_uuid` es un identificador de destino que el servidor autoriza mediante `auth.uid()`, nunca una prueba de permiso. El tipo proviene de metadata validada server-side, no del path. Las futuras policies dejan de usar `storage.extension(name)` para esta clase de objetos. El bucket limita los MIME declarados y el servidor inspecciona los bytes reales.

### Pipeline confiable

La carga se realiza mediante una Edge Function autenticada y no mediante escritura directa de cliente a Storage. El frontend primero obtiene un asset `pending` por RPC y luego envia `asset_id` y el binario a la funcion con su JWT. La funcion vuelve a comprobar el asset como owner/admin PRO, inspecciona magic bytes, decodifica imagen, valida tamano y dimensiones, elimina EXIF/metadatos mediante re-encoding a WebP y escribe el objeto con credenciales de servidor. Solo despues registra los atributos verificados y activa el asset por RPC.

`service_role`, si se usa para la API de Storage o para una operacion SQL interna no expuesta, existe solo como secreto de la Edge Function. No se expone al navegador.

### Metadata y lifecycle

`branding_assets` se extiende con los siguientes campos. Ninguno admite escritura directa de cliente.

| Campo | Regla | Escritura | Motivo |
| --- | --- | --- | --- |
| `id`, `tenant_id`, `storage_path` | Obligatorios e inmutables. | RPC de inicio. | Identidad, aislamiento y path estable. |
| `asset_kind` (`logo`/`banner`) | Obligatorio e inmutable. | RPC de inicio. | Hace verificable la referencia de `tenant_branding`. |
| `status` | Obligatorio. | RPCs de lifecycle e interno server-side. | Recuperacion entre Storage y PostgreSQL. |
| `mime_type`, `byte_size`, `width`, `height` | Nulos solo en `pending`; obligatorios desde `active`. | Edge Function verificada. | Validacion y render seguro. |
| `sha256` | Nulo solo en `pending`; obligatorio desde que existe objeto. | Edge Function verificada. | Idempotencia e integridad ante reintentos. |
| `created_by` | Obligatorio e inmutable. | RPC, derivado de `auth.uid()`. | Trazabilidad administrativa. |
| `activated_at` | Nulo hasta activacion; inmutable despues. | RPC de activacion. | Auditoria y orden de reemplazos. |
| `deleted_at` | Nulo salvo estado `deleted`. | Proceso de limpieza. | Evidencia de borrado y reconciliacion. |
| `retention_until` | Obligatorio solo en `suspended`. | Operacion de downgrade. | Retencion limitada y purga determinista. |

`original_filename` se omite: no es necesario para autorizacion, preview ni lifecycle y puede retener datos personales. El nombre original solo puede vivir transitoriamente en memoria del cliente/funcion.

Estados definitivos:

- `pending`: metadata creada; objeto aun no esta validado/activado.
- `active`: objeto validado y referenciado como logo o banner vigente.
- `suspended`: asset retenido tras downgrade; no se presenta ni se puede leer como branding PRO.
- `cleanup_pending`: objeto desreferenciado y pendiente de borrado/reintento.
- `deleted`: objeto confirmado como eliminado; metadata retenida solo para auditoria y luego purgable.

Transiciones permitidas: `pending -> active|cleanup_pending`; `active -> cleanup_pending|suspended`; `suspended -> active|cleanup_pending`; `cleanup_pending -> deleted`. Un RPC de reemplazo bloquea la fila de `tenant_branding`: activa el nuevo asset y mueve el anterior a `cleanup_pending` en una unica transaccion PostgreSQL.

### Limites de imagen

Se aceptan como entrada PNG, JPEG y WebP; SVG permanece prohibido. Tras verificacion se re-encoda a WebP para eliminar EXIF y normalizar la entrega.

| Asset | Tamano maximo | Dimensiones validas | Dimension recomendada |
| --- | --- | --- | --- |
| Logo | 1 MiB | 256x256 a 2048x2048 | 512x512 |
| Banner | 2 MiB | 1200x450 a 2400x900 | 1600x600 |

Estos limites son adecuados para preview responsive, PWA y Capacitor: el logo admite alta densidad sin descargar recursos grandes y el banner conserva proporcion 8:3 con un maximo razonable para red movil. El bucket debe aplicar el maximo general de 2 MiB; la Edge Function aplica el limite menor para logo.

### Autorizacion y lectura

| Operacion | Parametros / resultado | Autorizacion y validaciones | Concurrencia y permisos |
| --- | --- | --- | --- |
| `begin_branding_asset` | `p_tenant_id`, `p_asset_kind`; retorna `asset_id`, `storage_path`, `status`. | `p_tenant_id` solo localiza; `auth.uid()` debe ser owner/admin activo y el tenant PRO. Crea metadata `pending` sin atributos de archivo. | `SECURITY DEFINER`, `search_path = public, auth`; lock asesorado por tenant/tipo para no crear pendientes competidores. `EXECUTE` solo a `authenticated`; revocado de `PUBLIC`. |
| `get_pending_branding_asset_for_upload` | `p_asset_id`; retorna solo `asset_id`, `tenant_id`, `storage_path` y `asset_kind`. | Deriva tenant desde el asset y revalida owner/admin, PRO y `status = pending`; no acepta tenant ni path. | `SECURITY DEFINER`, `search_path = public, auth`; `EXECUTE` solo a `authenticated`, revocado de `PUBLIC`. Es la unica lectura user-JWT de un pending asset. |
| `record_verified_branding_asset` | `p_asset_id`, MIME detectado, bytes normalizados, ancho, alto y SHA-256; retorna metadata verificada. | Solo interno: exige `pending`, path derivado y valores dentro de limite. No acepta tenant, path ni kind. | `SECURITY DEFINER`, mismo `search_path`; sin grant a `authenticated` ni `PUBLIC`, solo al rol seguro usado por la Edge Function. Es idempotente si SHA-256 coincide. |
| `activate_branding_asset` | `p_asset_id`; retorna branding actualizado y asset anterior, si existia. | Deriva tenant y kind desde asset; revalida owner/admin y PRO, exige metadata verificada y objeto presente. No acepta tenant ni path. | `SECURITY DEFINER`, mismo `search_path`; bloquea `tenant_branding` y assets implicados con `FOR UPDATE`. Repetir la activacion vigente retorna exito idempotente. `EXECUTE` solo a `authenticated`. |
| `remove_branding_asset` | `p_tenant_id`, `p_asset_kind`; retorna asset marcado o resultado vacio idempotente. | Revalida owner/admin. Encuentra la referencia vigente por tenant/kind; no acepta `asset_id` ni path de cliente. No exige PRO, para permitir eliminar durante una transicion de plan. | `SECURITY DEFINER`, mismo `search_path`; bloquea branding y pasa el asset a `cleanup_pending`. `EXECUTE` solo a `authenticated`. |
| `get_active_branding_assets` | `p_tenant_id`; retorna solo kind, dimensiones, MIME y path de assets activos. | `p_tenant_id` se filtra por membership activa y PRO; no entrega URLs persistentes ni capacidades de escritura. | `SECURITY INVOKER` o vista RLS; sin bypass. `SELECT` solo a `authenticated`. |

Todas las funciones `SECURITY DEFINER` fijan `search_path`, reciben privilegio minimo y revocan acceso de `PUBLIC`. La tabla no concede INSERT/UPDATE/DELETE directos a `authenticated`. Una constraint/trigger exige que `logo_asset_id` apunte a `asset_kind = logo` y `banner_asset_id` a `asset_kind = banner`, siempre con el mismo `tenant_id`.

El cliente puede pedir una URL signed corta para un asset activo autorizado; no se usan URLs publicas ni se persisten URLs signed. Las policies de `storage.objects` permiten solo lectura de objetos activos del tenant para miembros con entitlement PRO, sin listado amplio; no conceden INSERT/UPDATE/DELETE a clientes.

### Edge Function

Contrato futuro `POST /functions/v1/branding-asset`:

1. Recibe `Authorization: Bearer <JWT>`, `asset_id` y multipart con un unico archivo.
2. Valida el JWT; usa unicamente `sub` para identidad y `role` para exigir sesion `authenticated`. No usa claims de tenant enviados por body ni guarda el JWT.
3. Consulta `get_pending_branding_asset_for_upload(asset_id)` mediante un cliente con JWT de usuario; tenant, rol y plan se resuelven por RPC desde la base de datos.
4. Comprueba nuevamente owner/admin, PRO, `status = pending`, `asset_kind` y path derivado del asset.
5. Rechaza archivos fuera de limite, firmas no PNG/JPEG/WebP, MIME declarado que no coincida con el detectado, decodificacion invalida o dimensiones fuera de rango.
6. Re-encoda a WebP, calcula SHA-256, escribe con `upsert: false` en el path asignado y registra metadata verificada mediante operacion interna.
7. Llama a `activate_branding_asset` usando el JWT original para que la autorizacion y entitlement se revaliden en el instante de activacion.

El `asset_id` es la clave de idempotencia: reintentar una carga pendiente con el mismo binario produce el mismo SHA-256 y puede continuar; un binario distinto para el mismo asset se rechaza. Si Storage funciona y PostgreSQL falla, el asset queda `pending` y un reconciliador lo reintenta o lo pasa a `cleanup_pending`. La activacion PostgreSQL es atomica; si falla, el objeto no queda referenciado. Si falla el borrado del asset anterior, el estado `cleanup_pending` conserva el trabajo para un retry idempotente. El proceso de limpieza debe usar la API de Storage, nunca mutaciones directas de tablas `storage`.

El reconciliador usa solamente una credencial interna y `service_role`; no acepta JWT de usuario. PostgreSQL reclama batches acotados con `FOR UPDATE SKIP LOCKED` y un token efimero. Tras el umbral, un `pending` abandonado o un `suspended` vencido cuyo tenant siga FREE y no tenga referencia pasa a `cleanup_pending`; no se activa automaticamente ningun asset. Solo la RPC que conserva el claim puede confirmar `deleted` despues de que Storage confirme el borrado o ausencia del objeto. Los objetos sin metadata se eliminan solo si su path es canonico y su antiguedad verificable supera un periodo de gracia; ante duda se registran y se conservan.

### Downgrade PRO a FREE

Se adopta retencion privada limitada: al downgrade, los assets `active` pasan a `suspended` y reciben `retention_until = now() + 30 days`. El resolvedor de branding devuelve inmediatamente branding SportLeagues para FREE, y Storage niega nuevas lecturas de assets PRO. La UI elimina previews y URLs en memoria al refrescar entitlement. Las URLs signed ya emitidas no pueden revocarse retroactivamente, por lo que su expiracion maxima sera 60 segundos; ningun sistema puede retirar bytes ya descargados.

Si el tenant vuelve a PRO antes de la retencion, un proceso autorizado puede restaurar los assets suspendidos referenciados. Al vencer `retention_until`, pasan a `cleanup_pending` y se borran de Storage con reintentos; despues quedan `deleted`. Esto evita perdida accidental, impide uso FREE y limita coste de retencion.

## Alternativas consideradas

1. **Cliente escribe directo a Storage y luego actualiza metadata.** Rechazada: no inspecciona binarios de forma fiable, deja una ventana de objetos huerfanos y confia demasiado en controles cliente.
2. **Solo Storage policies + RPC.** Rechazada: pueden validar identidad, path y metadata, pero no firma binaria, MIME real ni dimensiones.
3. **Un bucket por tenant.** Rechazada: aumenta administracion, policies y lifecycle sin aportar aislamiento superior al path tenant-scoped con RLS.
4. **Bucket publico.** Rechazada: contradice ADR-006 y no permite revocar branding PRO de manera razonable.
5. **Paths con extension o nombre original.** Rechazada: duplica una fuente de verdad insegura y contradice el contrato UUID; MIME se valida fuera del nombre.
6. **Eliminar inmediatamente al downgrade.** Rechazada: es irreversible ante un cambio de plan accidental y no aporta una ventaja de seguridad frente a denegar lectura de inmediato.

## Consecuencias

La Fase 05 necesita una migracion futura para schema, grants, policies y RPCs; una Edge Function; pruebas RLS/Storage negativas y E2E de carga, reemplazo, borrado, concurrencia y downgrade. Se requiere un reconciliador programado para `pending`, `cleanup_pending` y retenciones vencidas. La UI queda como cliente de estado y nunca como autoridad de plan, tenant o tipo.

## Seguridad / privacidad

No se admite SVG. La re-codificacion elimina EXIF y metadatos innecesarios. Los paths no contienen nombres de personas. `created_by` se conserva solo para auditoria administrativa. No se registran JWT, URLs signed ni nombres originales en logs. La autorizacion se deriva siempre de `auth.uid()` y membership activa; cambiar un path, `tenant_id` o `asset_id` desde el navegador no otorga acceso cruzado.

## Migracion / rollback

Este ADR no aplica schema ni Cloud. La implementacion futura sera forward-only y no debe borrar datos existentes al desplegar. Antes de retirar las policies basadas en extension se deben introducir las nuevas policies y probar cargas reales. Un rollback funcional consiste en deshabilitar la UI/Edge Function y resolver branding a SportLeagues; no se deben borrar objetos sin procesar el lifecycle `cleanup_pending`.
