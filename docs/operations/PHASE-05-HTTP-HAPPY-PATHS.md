# Runbook — Happy paths HTTP de Fase 05 (QA)

Objetivo: cerrar el último gate técnico de Fase 05/05-bis ejecutando, contra QA, las Edge Functions
`branding-asset` (JWT real de Admin 2) y `branding-reconciler` (credencial interna). Lo ejecuta el
operador en su máquina; el agente solo recibe la salida resumida (códigos HTTP y resultados).

## Reglas

- No pegar JWT, secretos ni anon keys en chats, tickets, reportes o commits.
- Cargar los valores con `read -rs` para que no queden en el historial de la shell.
- Los scripts no imprimen secretos ni cuerpos completos y pasan los headers sensibles a `curl`
  desde archivos temporales con permisos 600, eliminados al terminar.
- Ejecutar en Git Bash (Windows) o cualquier bash con `curl` y `node`.

## Efectos en QA

- `branding-asset`: activa temporalmente el fixture `supabase/tests/fixtures/branding/qa-logo-512.png`
  (círculo verde, 512×512) como logo del tenant de Admin 2 y **restaura el logo previo al
  terminar**. Banner y colores no se tocan.

### Restauración del logo

El lifecycle no permite reactivar un asset reemplazado: `activate_branding_asset` pasa el logo
anterior a `cleanup_pending` y el reconciliador borra su objeto. Por eso el script:

1. **B1 — Respaldo:** antes de cualquier cambio descarga el logo activo con el JWT de Admin 2 y
   verifica tamaño, tipo real y, si la API lo expone, SHA-256. Si el respaldo no es íntegro, aborta
   sin modificar QA.
2. Ejecuta A1–A11.
3. **Z1/Z2 — Restauración:** vuelve a cargar los bytes respaldados por el mismo flujo autorizado
   (`begin_branding_asset` + `branding-asset`) y verifica que vuelven a ser el logo activo con las
   dimensiones originales. Si el tenant no tenía logo, retira el de prueba con
   `remove_branding_asset`. Si el logo original sigue activo (fallo antes de A9), no hace nada.
4. La restauración también se ejecuta ante errores intermedios, fallos de red o Ctrl+C.

El logo restaurado es la misma imagen pero queda como un **asset nuevo**: otro `asset_id` y la imagen
re-normalizada a WebP, que puede no coincidir byte a byte. Si la restauración falla, el script
guarda el respaldo en `supabase/.temp/qa-branding-backup/` (ignorado por Git) e indica cargarlo a
mano desde `/admin`.
- `branding-reconciler`: ejecuta dos corridas reales de reconciliación con la política documentada
  en `supabase/functions/branding-reconciler/README.md`.

## Valores necesarios

| Variable | Cómo obtenerla |
| --- | --- |
| `SUPABASE_URL` | `https://juoftaofzepxbrrxbkhx.supabase.co` (QA). |
| `SUPABASE_ANON_KEY` | Dashboard → Project Settings → API → anon public key. |
| `ADMIN2_JWT` | Iniciar sesión como Admin 2 en `https://sportleagues-qa.vercel.app` y, en la consola de DevTools: `JSON.parse(localStorage.getItem('sb-juoftaofzepxbrrxbkhx-auth-token')).access_token`. Dura ~1 hora. |
| `TENANT_B_ID` | UUID del tenant que administra Admin 2 (Dashboard → Table editor → `tenants`). Debe tener `plan_code = 'pro'` en `tenant_entitlements`. |
| `TENANT_A_ID` | Opcional: UUID de Tenant A, para el negativo cross-tenant. |
| `BRANDING_RECONCILER_SECRET` | Valor configurado en QA. Ver "Si no se conoce la credencial interna". |

### Si Tenant B no es PRO

El paso A7 fallará con `pro branding is required`. Asignar el plan en QA desde el SQL Editor,
como operación de fixture QA autorizada por el operador:

```sql
update public.tenant_entitlements set plan_code = 'pro' where tenant_id = '<TENANT_B_ID>';
```

### Si no se conoce la credencial interna

El secreto se generó en memoria y nunca se registró, así que no se puede recuperar. Rotarlo con un
valor nuevo generado localmente (la rotación la decide y ejecuta el operador):

```bash
read -rs BRANDING_RECONCILER_SECRET < <(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))'; echo)
export BRANDING_RECONCILER_SECRET
(umask 077; printf 'BRANDING_RECONCILER_SECRET=%s\n' "$BRANDING_RECONCILER_SECRET" > /tmp/reconciler.env)
npx supabase secrets set --env-file /tmp/reconciler.env --project-ref juoftaofzepxbrrxbkhx
rm -f /tmp/reconciler.env
```

Guardar el valor en el gestor de secretos del equipo si el Cron futuro lo necesitará.

## Ejecución

```bash
export SUPABASE_URL=https://juoftaofzepxbrrxbkhx.supabase.co
read -rsp 'anon key: ' SUPABASE_ANON_KEY; echo; export SUPABASE_ANON_KEY
read -rsp 'JWT Admin 2: ' ADMIN2_JWT; echo; export ADMIN2_JWT
read -rp 'TENANT_B_ID: ' TENANT_B_ID; export TENANT_B_ID
read -rp 'TENANT_A_ID (opcional): ' TENANT_A_ID; export TENANT_A_ID

bash scripts/qa/branding-asset-happy-path.sh

read -rsp 'Secreto reconciliador: ' BRANDING_RECONCILER_SECRET; echo; export BRANDING_RECONCILER_SECRET
bash scripts/qa/branding-reconciler-happy-path.sh

unset ADMIN2_JWT BRANDING_RECONCILER_SECRET SUPABASE_ANON_KEY
```

Ejecutar `branding-asset` primero: el JWT caduca en ~1 hora y el script lo valida antes de llamar a
QA.

## Resultados esperados

| Paso | Verificación | Esperado |
| --- | --- | --- |
| B1 | Respaldo íntegro del logo activo (o tenant sin logo) | `ok` |
| A1 | Preflight CORS desde el origen QA | `204` + `access-control-allow-origin` |
| A2 | Sin JWT de usuario | `401` |
| A3 | JWT inválido | `401` |
| A4 | Origen no permitido | `403 FORBIDDEN` |
| A5 | `asset_id` inexistente | `404 ASSET_NOT_FOUND` |
| A6 | `begin_branding_asset` en tenant ajeno | `403 not authorized` |
| A7 | `begin_branding_asset` en tenant propio | `200 pending` |
| A8 | Archivo que no es imagen | `415 INVALID_IMAGE_TYPE` |
| A9 | Carga, normalización, metadata y activación | `200 active` |
| A10 | Replay del mismo asset | `409 INVALID_ASSET_STATE` |
| A11 | Logo activo en `get_active_branding_assets` | `logo image/webp 512x512` |
| Z1 | Recarga del logo original (o retiro del de prueba) | `200 active` / `200` |
| Z2 | Logo original activo de nuevo (o tenant sin logo) | `image/webp <ancho>x<alto>` / `sin-logo` |
| R1 | `GET` | `405 METHOD_NOT_ALLOWED` |
| R2 | Sin credencial | `401 UNAUTHORIZED` |
| R3 | Credencial incorrecta | `401 UNAUTHORIZED` |
| R4 | Corrida con `x-reconciler-secret` | `200`, `errors=0` |
| R5 | Segunda corrida con `Bearer` | `200`, `errors=0` |

Cada script termina con `RESUMEN: PASS=n FAIL=n SKIP=n` y sale con código distinto de cero si algún
paso falla. Devolver al agente la salida completa: no contiene secretos ni UUID.

En R4/R5, `inconsistencies > 0` no hace fallar el script, pero debe revisarse en los logs de la
función por `run_id` antes de aceptar la fase.
