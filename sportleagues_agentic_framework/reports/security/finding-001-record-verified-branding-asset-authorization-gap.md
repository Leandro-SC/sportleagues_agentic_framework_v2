# Hallazgo de seguridad 001 — `record_verified_branding_asset` sin autorización interna (cross-tenant)

- Severidad: **Alta** (integridad de datos cross-tenant; ver alcance/limitaciones abajo).
- Estado: `CONFIRMED` contra Supabase Cloud QA/UAT (`plataforma_bet`, `juoftaofzepxbrrxbkhx`), en una transacción `begin/rollback` — no persiste ningún dato.
- Detectado durante: validación post-migración de Fase 05 / 05-bis en QA (2026-09-16).
- Corresponde a la prioridad #6 de `docs/security/01-security-baseline.md` ("Uploads de logos/banners no validados").
- **No corregido.** Por instrucción explícita, esta tarea no modifica SQL en Cloud. Requiere una migración correctiva autorizada aparte.

## Resumen

`public.record_verified_branding_asset(p_asset_id, p_mime_type, p_byte_size, p_width, p_height, p_sha256)` es la única RPC de todo el proyecto pensada para ser exclusiva de `service_role` (llamada solo por la Edge Function `branding-asset` tras validar la imagen) que **no contiene ninguna comprobación interna de autorización**: no verifica `auth.uid()`, no verifica `is_tenant_admin`, no verifica `auth.role() = 'service_role'`. Su única defensa prevista era el `grant execute ... to service_role;` de la migración — pero esa defensa **no es efectiva en este proyecto Supabase**, así que cualquier `authenticated` (posiblemente también `anon`) puede invocarla directamente para escribir metadata "verificada" arbitraria sobre el `branding_assets.id` `pending` de **cualquier tenant**, no solo el propio.

## Causa raíz

1. El proyecto Supabase (QA y, presumiblemente, cualquier proyecto nuevo con el mismo template) tiene privilegios por defecto a nivel de esquema `public`:
   `ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`
   Esto se confirmó leyendo `pg_default_acl` en QA: toda función nueva creada por `postgres`/`supabase_admin` en `public` recibe automáticamente `EXECUTE` para `anon`, `authenticated` **y** `service_role` en el momento de su creación.
2. Cada migración de este proyecto sigue el patrón `revoke all on function ... from public; grant execute on function ... to <rol deseado>;`. Ese `revoke ... from public` **no elimina** los grants ya otorgados directamente a `anon`/`authenticated` por el paso 1, porque esos no son grants "vía PUBLIC" sino grants explícitos por rol aplicados al crear la función. Solo un `revoke execute on function ... from anon, authenticated;` explícito los removería.
3. Para el resto de RPCs "sensibles" del proyecto (incluidas las 5 funciones de reconciliación de branding, y todas las RPC de Fase 03/04/05 como `is_tenant_admin`, `join_pool`, `manage_pool`, etc.), esto **no es explotable** porque cada una hace su propia comprobación interna (`if auth.uid() is null then raise ...`, `if not is_tenant_admin(...) then raise ...`, o `perform assert_branding_reconciler_service_role()` que verifica `auth.role() = 'service_role'`). El GRANT permisivo queda neutralizado por la lógica de la función.
4. `record_verified_branding_asset` es la única excepción: se escribió asumiendo que el `grant ... to service_role` por sí solo bastaba, sin agregar ninguna comprobación interna — precisamente porque, a diferencia de las funciones de reconciliación (que sí tienen `assert_branding_reconciler_service_role()`), a esta no se le agregó ese guard.

## Evidencia (QA, solo lectura salvo lo indicado; todo en transacciones con `rollback`)

1. Privilegios por defecto del esquema (`pg_default_acl`, schema `public`, `objtype = 'f'` para funciones): `anon=X`, `authenticated=X`, `service_role=X` otorgados por `postgres`/`supabase_admin`.
2. `has_function_privilege('anon', 'public.record_verified_branding_asset(...)', 'execute')` → `true`. Igual para `authenticated`.
3. Llamada real como `authenticated` (con `request.jwt.claim.role = 'authenticated'`, igual que en una petición REST real) contra un `asset_id` inexistente: la función ejecuta su lógica de negocio normalmente (`ERROR: branding asset not found`, no un error de permisos) — confirma que ningún guard de autorización se ejecuta antes de esa lógica.
4. **Prueba de concepto de escritura cross-tenant** (transacción con `rollback`, nada persistido):
   - Owner B (`44444444-...`, tenant B, PRO) crea un asset `pending` con `begin_branding_asset`.
   - Sin cambiar de rol a `service_role`, se cambia el `sub` del JWT simulado a Owner A (`11111111-...`, tenant A, sin ninguna relación con tenant B).
   - Owner A invoca `record_verified_branding_asset(<asset de tenant B>, 'image/png', 999, 999, 999, '99...9')` **con éxito**, sobrescribiendo `mime_type`, `byte_size`, `width`, `height`, `sha256` del asset de Tenant B.
5. El propio test histórico del proyecto (`supabase/tests/phase-05-branding-assets.sql`, línea 77) ya esperaba que esta llamada fallara con `insufficient_privilege` para un llamador `authenticated` — esa aserción **falla** al ejecutarse contra QA real, confirmando independientemente el mismo hallazgo (ver `reports/admin/phase-05bis-qa-validation.md`, sección de suites SQL).

## Impacto

- Cualquier cuenta autenticada (y potencialmente `anon`, según la misma prueba de grants) que conozca o adivine el UUID de un `branding_assets` en estado `pending` de **cualquier tenant** puede sobrescribir su metadata "verificada" con valores arbitrarios, sin pasar por la validación real de imagen que hace la Edge Function `branding-asset` (que todavía no está desplegada).
- Esto rompe el modelo de confianza descrito en `ADR-007-private-branding-image-lifecycle.md` (la metadata verificada debía ser una garantía de que la Edge Function realmente decodificó y validó el archivo).
- Consecuencia directa práctica más probable: un usuario de un tenant podría interferir con la carga de branding de OTRO tenant (sobrescribir su metadata antes de que la Edge Function real complete su verificación, dejando el asset en un estado inconsistente) o marcar como "verificado" un archivo que nunca pasó controles de tipo/tamaño/dimensión.
- **Mitigado parcialmente, no eliminado, porque:**
  - `activate_branding_asset` (el paso que realmente pone un asset en producción/visible) sí verifica `is_tenant_admin` del tenant dueño del asset — un atacante no puede activar el asset de otro tenant, solo corromper su metadata de verificación mientras está `pending`.
  - Las Edge Functions de branding (`branding-asset`, `branding-reconciler`) **no están desplegadas todavía** (explícitamente fuera de alcance de esta fase), así que hoy no hay flujo real de carga de imágenes en producción que dependa de esto — pero el gap existe en el schema ya aplicado a QA y se activaría en cuanto se despliegue la Edge Function real, o si alguien invoca la RPC directamente contra Cloud como se demostró aquí.
  - No se detectó una vía para leer datos de otro tenant (es un problema de integridad/escritura, no de confidencialidad) a través de esta función específica.

## Recomendación de corrección (no aplicada; requiere autorización y migración aparte)

Agregar a `record_verified_branding_asset` (y, como hardening preventivo del patrón, auditar cualquier futura función pensada para `service_role`) una comprobación interna equivalente a la ya usada en la reconciliación:

```sql
if auth.role() <> 'service_role' then
  raise exception 'record_verified_branding_asset requires service role' using errcode = '42501';
end if;
```

Adicionalmente, revisar sistemáticamente **todas** las funciones `to service_role` (hoy son 6 en total: las 5 de reconciliación + esta) para no depender nunca más del GRANT como única barrera, y considerar un `revoke execute on function <fn> from anon, authenticated;` explícito como defensa adicional en cada una — sabiendo que, por el default ACL del proyecto, ese revoke debe repetirse en cada función `service_role`-only, no asumirse heredado de `revoke ... from public`.

## Próximo paso permitido

No corregir en esta tarea. Preparar una migración correctiva dedicada (`assert_branding_reconciler_service_role`-style guard dentro de `record_verified_branding_asset`, más el `revoke` explícito), presentarla para revisión, y volver a ejecutar `supabase/tests/phase-05-branding-assets.sql` (una vez completo el fixture de QA o corrido localmente) antes de considerar este hallazgo cerrado.
