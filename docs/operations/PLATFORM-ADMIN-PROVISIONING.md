# Provisioning manual de Superadmin de plataforma

Referencia: `docs/architecture/adr/ADR-008-platform-superadmin-authorization.md`.

`platform_admins` no concede ningún grant a `authenticated`/`anon` (ver ADR-008), así que no existe
ni existirá un formulario o RPC de auto-registro. Otorgar el rol es siempre una operación manual,
ejecutada por quien ya tiene acceso administrativo a Supabase Cloud (SQL editor del proyecto).

## Primer Superadmin (bootstrap)

No hay todavía ningún otro platform admin que pueda figurar como `granted_by`. Por eso `granted_by`
es nullable: `NULL` significa explícitamente "otorgado por bootstrap manual fuera de banda", no un
otorgante desconocido u omitido por error.

Requisito previo: la migración `20260915000400_phase_05bis_platform_admin_foundation.sql` debe
estar aplicada en el proyecto donde se va a provisionar. No ejecutar nada de esto contra un
proyecto donde la migración siga pendiente.

### Paso 1 — Localizar el UUID correcto (nunca el email como autoridad)

El email solo sirve para **ubicar visualmente** la cuenta correcta; el `id` (UUID) es la única
autoridad que se guarda.

- Dashboard → Authentication → Users → busca tu email de inicio de sesión (Google/Magic Link) →
  copia el `User UID` mostrado ahí. Es la forma más segura porque no requiere escribir SQL de
  búsqueda con el email.
- Alternativa por SQL editor, solo para confirmar visualmente antes de copiar el UUID (no guardar
  este SELECT en ningún archivo versionado):

  ```sql
  select id, email, created_at from auth.users where email = '<tu email de login>';
  ```

Confirma que es una sola fila y que `email` coincide exactamente con la cuenta que usarás para
entrar a `/superadmin` antes de continuar.

### Paso 2 — Insertar el primer registro

Ejecutar en el SQL editor de Supabase Cloud, **fuera de cualquier migración versionada** y sin
registrar el UUID en el repositorio:

```sql
insert into public.platform_admins (user_id, granted_by, note)
values ('<AUTH_USER_UUID>', null, 'bootstrap inicial');
```

`granted_by = null` únicamente porque es el bootstrap: no existe todavía otro Superadmin que
pueda figurar como otorgante. No usar `service_role` desde el frontend para esto bajo ninguna
circunstancia; esta operación es exclusivamente vía SQL editor/consola de Supabase con la sesión
administrativa del proyecto.

### Paso 3 — Verificar que `is_platform_admin()` devuelve `TRUE`

El SQL editor normalmente corre como `postgres` (superusuario), así que `auth.uid()` sería `NULL`
ahí salvo que se simule explícitamente la identidad autenticada, igual que hacen los tests de
`supabase/tests/phase-05bis-platform-admin.sql`:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<AUTH_USER_UUID>', true);
select public.is_platform_admin(); -- debe devolver t (true)
rollback;
```

El `rollback` es intencional: esto solo simula la sesión para verificar, no debe dejar cambios.
La comprobación real y definitiva es entrar a `/superadmin` con esa cuenta desde el navegador.

### Paso 4 — Verificar que sigue sin existir acceso directo a la tabla

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '<AUTH_USER_UUID>', true);
select * from public.platform_admins; -- debe fallar: permission denied for table platform_admins
rollback;
```

Si este `select` devuelve filas en vez de fallar, hay una regresión de permisos (algún `grant`
se agregó después de esta migración) y no se debe continuar usando `/superadmin` hasta corregirlo.

## Añadir un segundo (o posterior) Superadmin

Una vez que exista al menos un platform admin activo, la vía recomendada deja de ser el bootstrap
manual: el alta debe hacerse desde una RPC futura (`grant_platform_admin`, pendiente de
implementación en una fase posterior) que:

- exija `is_platform_admin()` verdadero para quien la invoca;
- inserte `granted_by = auth.uid()` (nunca `NULL` a partir de este punto);
- quede registrada en auditoría.

Hasta que esa RPC exista, un alta adicional sigue una operación manual igual a la de bootstrap, pero
con `granted_by` igual al `user_id` del Superadmin que autoriza el alta (no `NULL`), dejando rastro
de quién lo hizo.

## Revocar un Superadmin

```sql
update public.platform_admins set revoked_at = now() where user_id = '<AUTH_USER_UUID>';
```

La revocación es inmediata a nivel de PostgreSQL: `is_platform_admin()` reevalúa `revoked_at` en
cada llamada, sin depender de que expire o se refresque ningún token.

## Qué no hacer

- No insertar el bootstrap dentro de una migración versionada del repositorio.
- No hardcodear el email o UUID del Superadmin en el frontend, en tests, ni en ninguna migración.
- No usar `service_role` en `apps/platform`.
- No borrar filas de `platform_admins`; revocar (`revoked_at`) preserva la auditoría de quién tuvo
  acceso y cuándo.
