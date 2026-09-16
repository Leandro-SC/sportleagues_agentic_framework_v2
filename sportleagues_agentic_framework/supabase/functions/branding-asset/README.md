# `branding-asset` Edge Function

`POST /functions/v1/branding-asset` procesa un único archivo multipart para un asset de branding ya creado por `begin_branding_asset`.

## Contrato

La petición requiere `Authorization: Bearer <JWT>` y un cuerpo `multipart/form-data` con:

- `asset_id`: UUID del asset en estado `pending`.
- `file`: exactamente un archivo PNG, JPEG o WebP.

No acepta `tenant_id`, `storage_path`, plan, rol, tipo ni estado como autoridad. Tras validar el JWT, llama únicamente a `get_pending_branding_asset_for_upload(asset_id)` con el JWT original. PostgreSQL resuelve el tenant, permisos owner/admin, entitlement PRO y estado `pending`.

La respuesta de éxito es `200` con `{ "asset_id": "…", "status": "active" }`. Los errores tienen la forma `{ "code": "…", "message": "…" }`; los códigos estables son `UNAUTHORIZED`, `FORBIDDEN`, `ASSET_NOT_FOUND`, `INVALID_ASSET_STATE`, `PLAN_REQUIRED`, `FILE_REQUIRED`, `FILE_TOO_LARGE`, `INVALID_IMAGE_TYPE`, `INVALID_DIMENSIONS`, `IMAGE_DECODE_FAILED`, `STORAGE_FAILED`, `METADATA_FAILED`, `ACTIVATION_FAILED` e `INTERNAL_ERROR`.

## Pipeline

La función limita el body antes de decodificar, detecta firmas reales, valida dimensiones del encabezado y de la imagen decodificada, normaliza a WebP con `@imagemagick/magick-wasm`, elimina metadata con `strip()`, calcula SHA-256 y escribe con `upsert: false` en el path canónico devuelto por la RPC.

La metadata se registra mediante `record_verified_branding_asset` con `service_role`; la activación se hace mediante `activate_branding_asset` con el JWT original. Si falla metadata después de Storage, se intenta borrar el objeto. Si falla activación, la metadata y objeto permanecen `pending` y permiten un retry seguro. Ante un conflicto de Storage, la función compara el hash del objeto existente y nunca lo sobrescribe.

## Variables de entorno

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — solo Edge Function; nunca frontend, logs ni repositorio.
- `CORS_ALLOWED_ORIGINS` — lista separada por comas de orígenes web permitidos, por ejemplo `https://app.example.com,http://localhost:5173`. No hay comodín ni fallback permisivo.

La dependencia está fijada a `npm:@imagemagick/magick-wasm@0.0.43`. El WASM se resuelve desde el paquete instalado y se carga desde el filesystem del runtime; no se descarga ni depende de una URL pública en tiempo de ejecución.

## Ejecución local

Con Docker y Supabase local disponibles:

```powershell
supabase functions serve branding-asset --env-file .env.local
deno test --allow-env supabase/functions/branding-asset/image-validation.test.ts
```

No desplegar esta función sin haber aplicado y probado primero las migraciones de lifecycle y `get_pending_branding_asset_for_upload` en el entorno objetivo.
