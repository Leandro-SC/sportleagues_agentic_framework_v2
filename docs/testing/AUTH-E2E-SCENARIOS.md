# Escenarios E2E de autenticación (QA) — ejecución manual

Entorno: `https://sportleagues-qa.vercel.app` contra Supabase QA. Precondiciones: configuración de
`docs/operations/AUTH-QA-CONFIGURATION.md` completa y una cuenta de prueba `qa-<alias>@<dominio con buzón accesible>`.
Registrar cada resultado como PASS/FAIL/BLOCKED con evidencia sanitizada (sin correos completos, enlaces ni tokens).

**Estado actual: ninguno ejecutado en navegador** (falta una cuenta de prueba identificada y la configuración del Dashboard).

| ID | Escenario | Pasos | Esperado | Estado |
| --- | --- | --- | --- | --- |
| E1 | Registro | Portada → Crear cuenta; nombre, correo, contraseña válida y confirmación | Aviso neutro «Si el correo puede registrarse…»; llega correo de confirmación; no hay sesión | NO EJECUTADO |
| E2 | Validaciones de registro | Nombre vacío; contraseña corta, sin dígitos, sin letras; confirmación distinta | Error por campo; no se envía nada | NO EJECUTADO (tests unitarios PASS) |
| E3 | Registro con correo existente | Repetir E1 con el mismo correo | Mismo aviso neutro; ningún dato nuevo | NO EJECUTADO |
| E4 | Login sin confirmar | Iniciar sesión antes de confirmar | «Confirma tu correo antes de iniciar sesión» | NO EJECUTADO |
| E5 | Confirmación | Abrir el enlace del correo (también en otra pestaña/navegador) | Pasa por `/auth/callback`, sesión activa, perfil con el nombre, cae en Inicio | NO EJECUTADO |
| E6 | Login | Cerrar sesión; iniciar con correo y contraseña | Sesión activa, Inicio | NO EJECUTADO |
| E7 | Login incorrecto | Contraseña errónea; correo inexistente | Mismo mensaje «Correo o contraseña incorrectos.» | NO EJECUTADO en UI (probe L1 PASS a nivel API) |
| E8 | Recuperación | «¿Olvidaste tu contraseña?» → correo → enlace → nueva contraseña | Aviso neutro; el enlace abre `/auth/reset`; tras guardar entra a Inicio; la contraseña vieja ya no sirve | NO EJECUTADO |
| E9 | Recuperación con correo inexistente | Mismo flujo con correo no registrado | Mismo aviso neutro; no llega correo | NO EJECUTADO |
| E10 | Enlace expirado/reutilizado | Abrir dos veces el enlace de E8 | «El enlace expiró o ya fue usado…» | NO EJECUTADO |
| E11 | Cancelar recuperación | Abrir enlace, «Cancelar», luego iniciar sesión normal | Va a Inicio, no a `/auth/reset` | NO EJECUTADO |
| E12 | Google (cuenta nueva) | «Continuar con Google» con cuenta de prueba | Sesión activa, perfil con el nombre de Google | NO EJECUTADO |
| E13 | Google con perfil existente | Repetir con una cuenta que ya tiene perfil | No cambia `display_name`; sin perfil duplicado | NO EJECUTADO |
| E14 | Cuenta antigua de Magic Link | Mismo correo: «¿Olvidaste…?» y fijar contraseña | Conserva memberships y quinielas | NO EJECUTADO |
| E15 | Logout | Perfil → Cerrar sesión | Vuelve a la portada; `/perfil` redirige a Inicio; se borra la invitación pendiente | NO EJECUTADO |
| E16 | Protección de rutas | Sin sesión abrir `/perfil`, `/ligas`, `/auth/reset`, `/admin`, `/superadmin` | Todas redirigen a Inicio | NO EJECUTADO en navegador (tests de router PASS) |
| E17 | Rutas con roles | Usuario común → `/admin` y `/superadmin`; Admin → ambas | Usuario común a Inicio; Admin entra a `/admin` y no a `/superadmin` | NO EJECUTADO |
| E18 | Invitación y registro | Abrir `/j/<CÓDIGO>` sin sesión, registrarse y confirmar en otra pestaña | La invitación se conserva 24 h y se completa la unión; si caducó, Ligas → Unirme con código | NO EJECUTADO |
| E19 | Fallo de perfil | Cortar la red tras iniciar sesión sin perfil | «Completa tu perfil» con el nombre prellenado; reintento posible; sin duplicados | NO EJECUTADO |

Evidencia a devolver por escenario: resultado, descripción breve o captura sin datos personales, y hora UTC.
