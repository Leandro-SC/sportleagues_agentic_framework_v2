# `branding-reconciler` Edge Function

Operación interna, separada de `branding-asset`, para mantenimiento conservador del lifecycle privado de branding. No admite JWT de usuario ni CORS: requiere `POST` con `Authorization: Bearer <BRANDING_RECONCILER_SECRET>` o `x-reconciler-secret` desde Cron u operación controlada.

## Política

- `pending` con al menos 1 hora: pasa a `cleanup_pending`; no se activa automáticamente, aunque tenga metadata.
- `cleanup_pending`: elimina el objeto o acepta su ausencia y confirma `deleted`.
- `suspended` vencido: solo se limpia si sigue FREE y sin referencia de branding.
- `active`: solo comprueba Storage; ante objeto ausente registra un evento de auditoría y no altera el asset.
- Huérfanos: solo se borran si el path es exactamente `{tenant_uuid}/{asset_uuid}`, no hay metadata, y `created_at` verificable supera 1 hora. Objetos sin timestamp se conservan.

Las RPCs reclaman hasta 50 assets con locks y token. La confirmación final exige conservar el token, por lo que un cambio concurrente no puede finalizar como `deleted`. Errores de Storage dejan el claim hasta que expire en 15 minutos para retry posterior.

## Variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BRANDING_RECONCILER_SECRET` — secreto dedicado, solo entorno seguro/Cron.

## Cron futuro

Recomendación: cada 15 minutos, `POST /functions/v1/branding-reconciler` con el secreto dedicado y timeout de 60 segundos. No se configuró ningún Cron ni despliegue. Revise el JSON de resumen y logs por `run_id`; `errors` e `inconsistencies` requieren revisión, mientras que `deleted` confirma limpiezas.

## Local

```powershell
deno task check
deno task test
```

La integración completa requiere Supabase local con las migraciones aplicadas y Storage disponible.
