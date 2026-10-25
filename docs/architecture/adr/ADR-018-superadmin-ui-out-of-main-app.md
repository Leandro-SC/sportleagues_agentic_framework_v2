# ADR-018 — La UI de Superadmin sale de la aplicación principal

- Estado: **Accepted** (2026-10-12, por instrucción expresa del propietario en `docs/agents/ENCARGO_MAESTRO_SPORTLEAGUES.md` §2 y §12-Lote B). Reversible mediante un flag de compilación.
- Modifica: ADR-008 **solo en su punto 4** (guard y árbol de rutas `/superadmin/**` en el frontend). El resto de ADR-008 (tabla `platform_admins`, `is_platform_admin()`, RLS, GRANT/REVOKE, runbook de aprovisionamiento) **permanece vigente y sin cambios**.
- Impacto AGENTS.md §12: cambia superficie de autorización del frontend (no la autoridad en base de datos).

## Contexto

El producto visible tiene dos experiencias: `admin` (organizador) y `user` (participante). El control global de plataforma pertenecerá a **otra aplicación/entorno protegido**. Mantener una pantalla `/superadmin` dentro de la app pública amplía la superficie de ataque y sugiere una tercera experiencia.

## Decisión

1. La ruta `/superadmin`, `SuperadminView` y `SuperadminShell` **no se registran ni se empaquetan** en la app principal salvo que el build defina `VITE_ENABLE_SUPERADMIN_UI=true` (por defecto apagado; nunca activado en QA/producción).
2. Se **conserva** toda la infraestructura de autorización: `platform_admins`, `is_platform_admin()`, `register_platform_intervention`, `useSuperadmin` y `platformAdminRedirect` (con sus pruebas). No se borra ni desactiva nada en base de datos.
3. Ningún menú, enlace o RPC de la app principal ofrece operaciones globales a un `admin`. Un `platform_admin` sin membresía no obtiene acceso al panel de organizador (ADR-008 §9 sigue vigente).
4. La futura consola de plataforma consumirá las mismas RPC `SECURITY DEFINER` que validan `is_platform_admin()` en servidor.

## Consecuencias

- Las funciones globales ya no tienen interfaz en la app principal; el aprovisionamiento sigue por el runbook de `docs/operations/PLATFORM-ADMIN-PROVISIONING.md`.
- Para reactivar la UI temporalmente en un entorno controlado basta el flag; no hay migración que revertir.
- La tarea futura «consola de plataforma» queda `BLOCKED_DECISION` (hosting, dominio y política de acceso las define el propietario).
