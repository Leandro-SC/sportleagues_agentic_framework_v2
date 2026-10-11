# ADR-013 — Autenticación con correo/contraseña y Google; retiro de Magic Link

- Estado: Accepted (instrucción explícita del operador, 2026-10-10)
- Fecha: 2026-10-10
- Decisores: Architecture Agent, operador del proyecto
- Disparador (AGENTS.md §12): cambia auth/autorización y los datos personales de entrada.

## Contexto

El acceso era Magic Link (`signInWithOtp`) o Google OAuth. El perfil (`profiles.display_name`) lo crea
el cliente en `/onboarding`; no hay trigger en `auth.users`. Los roles viven solo en
`tenant_memberships` / `platform_admins` (ADR-002, ADR-008), nunca en el método de login.

## Decisión

1. Métodos permitidos: **correo + contraseña** (registro con nombre completo, confirmación de correo,
   recuperación de contraseña) y **Google OAuth**. Magic Link/OTP se elimina del producto; un test
   (`no-magic-link.test.ts`) impide reintroducir `signInWithOtp`/`verifyOtp`.
2. Las credenciales las gestiona exclusivamente Supabase Auth (`signUp`, `signInWithPassword`,
   `resetPasswordForEmail`, `updateUser`). No se guardan contraseñas en tablas propias, logs ni
   almacenamiento del navegador; los campos se vacían tras cada envío.
3. **Sin migraciones.** El nombre completo viaja en `user_metadata.full_name`. En la primera sesión,
   `ensureProfile` inserta `profiles(id, display_name)` con `ON CONFLICT DO NOTHING` bajo la policy
   `profiles_insert_self` (nombre saneado 1..80). Nunca pisa un perfil existente ni escribe rol o
   tenant. Si no hay nombre (p. ej. cuenta antigua), el guard existente envía a `/onboarding`.
4. Un único callback, `/auth/callback`, sirve confirmación de correo, OAuth y recuperación
   (`type=recovery` → `/auth/reset`). No se añaden URLs a la lista de redirecciones.
5. Anti-enumeración: el registro y la recuperación responden siempre con el mismo aviso; el login usa
   un único mensaje para credenciales inválidas; los errores desconocidos no reenvían texto del servidor.
6. Política de contraseña: mínimo 8, letras y números, máximo 72 (cliente y `config.toml`; la
   configuración de QA/producción debe coincidir, ver Seguimiento).
7. **Transición de cuentas Magic Link:** no se borran usuarios ni memberships. Fijan una contraseña con
   "¿Olvidaste tu contraseña?" (o siguen con Google). Misma identidad `auth.users.id` ⇒ mismos perfiles y memberships.
8. Vinculación de identidades: no se vincula manualmente (`enable_manual_linking = false`). Solo aplica el
   comportamiento documentado de Supabase para correos verificados; el signup con contraseña exige
   confirmar el correo, lo que evita la toma previa de cuenta.

## Alternativas descartadas

- Trigger `on auth.users insert` que cree el perfil: más robusto con confirmación de correo, pero toca
  el esquema `auth` y exige migración; se pospone. Riesgo asumido: `user_metadata` es editable por el
  usuario, aceptable porque solo alimenta un nombre para mostrar sin efecto de autorización.
- Mantener Magic Link como respaldo: contradice la instrucción del operador.

## Consecuencias / seguimiento (intervención humana en el Dashboard)

- Verificar en QA: Authentication → Providers (Email con "Confirm email" activo, política de contraseña
  8+ letras y dígitos, Google con client ID/secret), URL Configuration (Site URL y Redirect URLs deben
  incluir `https://sportleagues-qa.vercel.app/auth/callback`), plantillas "Confirm signup" y
  "Reset password" usando `{{ .ConfirmationURL }}`, y SMTP propio si el límite de correos por hora del
  SMTP por defecto estorba.
- Se mantiene el flujo `implicit` existente. Migrar a PKCE es una decisión aparte.
- La intención de unión ahora se guarda en `localStorage` (solo el código opaco + marca de tiempo, caduca a las 24 h, se borra al cerrar sesión). Alternativa manual: Ligas → Unirme con código.
- Perfil: un único intento automático por usuario y carga; si falla, `/onboarding` (nombre prellenado) permite reintentar sin duplicar (clave primaria `id`). Errores genéricos, sin texto del servidor.
- PKCE: evaluación en `docs/security/PKCE-MIGRATION-ASSESSMENT.md` (no ejecutada).
