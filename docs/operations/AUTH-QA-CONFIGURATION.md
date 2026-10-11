# Configuración de Auth en Supabase QA — pasos para el operador

Proyecto: `plataforma_bet` (`juoftaofzepxbrrxbkhx`), solo QA. **No aplicar en producción** sin otra autorización.
Lo verificable con la anon key lo comprueba `scripts/qa/auth-config-probe.mjs`; el resto solo se ve en el
Dashboard (marcado «Dashboard»).

| # | Ajuste | Esperado | Estado |
| --- | --- | --- | --- |
| 1 | Providers → Email habilitado | activo | PASS (probe) |
| 2 | Confirm email | activo (`mailer_autoconfirm=false`) | PASS (probe) |
| 3 | Providers → Google con client ID/secret | activo; redirige a accounts.google.com | PASS (probe) |
| 4 | Otros proveedores | desactivados | PASS (probe) |
| 5 | Site URL y Redirect URLs | ver pasos | **Dashboard — pendiente** |
| 6 | Política de contraseña | mínimo 8, letras y dígitos | **Dashboard — pendiente** |
| 7 | Plantillas Confirm signup / Reset password | usan `{{ .ConfirmationURL }}` | **Dashboard — pendiente** |
| 8 | SMTP | propio, o aceptar el límite del SMTP por defecto | **Dashboard — pendiente** |
| 9 | URI de redirección en Google Cloud | `https://juoftaofzepxbrrxbkhx.supabase.co/auth/v1/callback` | **Google Cloud — pendiente** |

## Pasos

1. **Redirect URLs** — Dashboard → Authentication → URL Configuration.
   - Site URL: `https://sportleagues-qa.vercel.app`
   - Redirect URLs (lista exacta, sin comodines amplios): `https://sportleagues-qa.vercel.app/auth/callback`.
     Añade `http://localhost:5173/auth/callback` solo si probarás en local; elimina cualquier `*` o URL ajena.
2. **Política de contraseña** — Authentication → Sign In / Providers → Email: «Minimum password length» = 8
   y «Password requirements» = *Letters and digits*. Guarda.
3. **Confirmación** — en el mismo panel de Email deja «Confirm email» activo. «Secure password change» puede
   quedar desactivado (el flujo de recuperación ya entrega una sesión reciente).
4. **Plantillas** — Authentication → Email Templates → «Confirm signup» y «Reset Password»: el enlace debe ser
   `{{ .ConfirmationURL }}`. No uses `{{ .Token }}`/OTP: la app no tiene pantalla para códigos. La plantilla
   «Magic Link» queda sin uso (la app ya no la dispara).
5. **SMTP** — Authentication → Emails → SMTP Settings. Con el SMTP por defecto hay un límite bajo de correos
   por hora y solo entrega a miembros del equipo del proyecto; para probar con correos externos configura un
   SMTP propio o usa cuentas de prueba que sean miembros del proyecto.
6. **Google Cloud** — Credenciales → tu cliente OAuth → «URI de redirección autorizados» debe contener la URL
   del punto 9. El ID de cliente y el secreto se pegan en Supabase (Providers → Google); no los compartas.
7. Vuelve a ejecutar el probe. R1 queda `BLOCKED` por diseño (la lista de Redirect URLs no se puede leer con
   la anon key); la prueba E5 (confirmación de correo) de `docs/testing/AUTH-E2E-SCENARIOS.md` la valida de verdad.

## Cuentas de prueba

Usa solo cuentas creadas para QA, con el prefijo `qa-` en el correo y sin membership privilegiada. Las cuentas
«Admin 1/2» y «Superadmin» ya existen en QA: si fueron de Magic Link, fijan contraseña con «¿Olvidaste tu
contraseña?». No se crean ni elevan cuentas privilegiadas desde la app.
