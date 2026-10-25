# Despliegue aislado de SportLeagues Control

La consola de plataforma se despliega en **un proyecto Vercel diferente** al de jugadores. Nunca añadir su ruta al proyecto Vercel principal.

## Configuración del proyecto nuevo

- Repositorio: `Leandro-SC/sportleagues_agentic_framework_v2`.
- Rama de producción: `feat/superadmin-control-plane`.
- Root Directory: raíz del repositorio (`.`), para reutilizar el lockfile y dependencias ya versionadas.
- Build Command: `npm run build:superadmin`.
- Output Directory: `apps/superadmin/dist`.
- Dominio: subdominio aislado, por ejemplo `control.tudominio.com`; no usar el dominio o subdominio público de jugadores.

Variables de entorno del proyecto de Control:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Las dos son claves públicas de cliente. No configurar `SUPABASE_SERVICE_ROLE_KEY`, secretos de proveedores ni credenciales de administración en Vercel o en el navegador.

## Activación de la primera cuenta

Provisionar `developer.gruposaysil@gmail.com` siguiendo `PLATFORM-ADMIN-PROVISIONING.md`: localizar el UUID en Supabase Auth y registrar ese UUID en `platform_admins`. No sustituir el UUID por el correo ni incorporarlo a Git.

## Validación

1. Abrir el subdominio aislado y autenticar con la cuenta provisionada.
2. Verificar tarjetas, organizaciones, solicitudes y precios.
3. Con una cuenta normal, confirmar que aparece «Acceso restringido».
4. Desde DevTools, intentar invocar `platform_console_overview` con la cuenta normal: debe responder `42501`.
