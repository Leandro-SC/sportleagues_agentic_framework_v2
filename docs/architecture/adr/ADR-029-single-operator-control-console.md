# ADR-029 — Operador único de la consola Control

- Estado: Accepted
- Fecha: 2026-10-26
- Decisor: Propietario del producto

## Contexto

La consola aislada de plataforma contiene operaciones cross-tenant. El propietario requiere que, en el alcance actual,
solo `developer.gruposaysil@gmail.com` pueda autenticarse y ejecutar sus RPCs, incluso si otra cuenta recibiera por error
una fila activa en `platform_admins`.

## Decisión

1. `platform_admins` conserva el rol global, la auditoría y la revocación existentes de ADR-008.
2. Se añade `is_control_operator()`, una función `security definer` que exige simultáneamente un rol activo y que el
   correo actual en `auth.users` coincida, sin distinguir mayúsculas, con la cuenta autorizada.
3. `platform_console_guard()` usa esta función. Por tanto, todas las RPCs de la consola rechazan cualquier otra cuenta
   con `42501`; el frontend no es la autoridad.
4. La interfaz no admite introducir un correo alternativo y limpia cualquier sesión previa de otra identidad en este
   origen. Esta capa es conveniencia y reducción de errores; la garantía está en PostgreSQL.
5. La restricción se limita a la consola aislada; no cambia roles tenant, rutas ni sesiones de la aplicación de jugadores.

## Consecuencias

- Incorporar otro operador exige una nueva decisión de producto, actualización de ADR, migración y pruebas; no basta
  con insertar otra fila de `platform_admins`.
- El correo queda versionado como dato de configuración de seguridad por instrucción explícita del propietario. No se
  registra contraseña, UUID, token ni clave privada.
